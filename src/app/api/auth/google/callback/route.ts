import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import Invitation from '@/lib/models/Invitation';
import { createSession } from '@/lib/auth/session';
import { verifyLoginOAuthState } from '@/lib/auth/loginOauthState';
import {
  syncRegisteredUserToBrevoInBackground,
  syncUserToBrevoInBackground,
} from '@/lib/services/brevoContactSync';
import { effectiveRegistrationApproval, registrationApprovalForSignup } from '@/lib/auth/registrationApproval';

/**
 * Handle Google OAuth callback
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL('/login?error=no_code', request.url));
    }

    // Verify signed state (CSRF protection); the initiate route always sets it
    const statePayload = state ? await verifyLoginOAuthState(state) : null;
    if (!statePayload) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    // Construct redirect URI from request URL to ensure it uses the correct domain
    const baseUrl = new URL(request.url).origin;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(new URL('/login?error=oauth_not_configured', request.url));
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      // Token exchange error
      return NextResponse.redirect(new URL('/login?error=token_exchange_failed', request.url));
    }

    const tokens = await tokenResponse.json();
    const { access_token } = tokens;

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      return NextResponse.redirect(new URL('/login?error=failed_to_get_user_info', request.url));
    }

    const googleUser = await userInfoResponse.json();
    const { id: googleId, email, name, picture } = googleUser;

    if (!email) {
      return NextResponse.redirect(new URL('/login?error=no_email', request.url));
    }

    await connectDB();

    // Invitation token travels inside the verified state payload
    let invitationToken: string | null = statePayload.invitationToken ?? null;

    let organizationId: string | undefined;
    let employeeId: string | undefined;
    let isNewUser = false;
    const isJoiningExistingOrg = false;

    // Handle invitation if present
    if (invitationToken) {
      const invitation = await Invitation.findOne({
        token: invitationToken,
        status: 'pending',
      });

      if (invitation && new Date() <= invitation.expiresAt) {
        if (invitation.email.toLowerCase() !== email.toLowerCase()) {
          return NextResponse.redirect(new URL('/login?error=email_mismatch', request.url));
        }

        organizationId = invitation.organizationId;
        employeeId = invitation.employeeId?.toString();

        invitation.status = 'accepted';
        await invitation.save();
        // Delete invitation after acceptance (no longer needed)
        await Invitation.findByIdAndDelete(invitation._id);
      } else {
        invitationToken = null; // Invalid invitation, treat as new user
        organizationId = undefined; // Reset organizationId
      }
    }

    // Find or create user
    let user = await User.findOne({ 
      $or: [
        { email: email.toLowerCase() },
        { googleId }
      ]
    });

    if (!user) {
      // New user - create account
      isNewUser = true;
      
      if (!invitationToken) {
        // New user without invitation: always create new organization (no auto-join by domain)
        organizationId = `temp-${Date.now()}`;
      }

      // Determine if organization setup is complete
      // If joining existing org, check if the org admin has completed setup
      let orgSetupComplete = !!invitationToken;
      if (isJoiningExistingOrg && organizationId) {
        const orgAdminId = organizationId;
        const orgAdmin = await User.findById(orgAdminId);
        orgSetupComplete = orgAdmin ? !!orgAdmin.organizationSetupComplete : false;
      }

      user = await User.create({
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        profilePicture: picture,
        googleId,
        authProvider: 'google',
        organizationId: organizationId!,
        organizationSetupComplete: orgSetupComplete,
        emailVerified: true,
        registrationApproval: registrationApprovalForSignup(Boolean(invitationToken)),
      });

      // If no invitation and not joining existing org, set organizationId to user's own ID
      if (!invitationToken && !isJoiningExistingOrg) {
        user.organizationId = user._id.toString();
        await user.save();
        organizationId = user._id.toString();
      }

      // Handle employee record
      if (invitationToken && employeeId) {
        let employee = await Employee.findById(employeeId);
        
        // If not found by ID, try to find by email and organizationId
        if (!employee) {
          employee = await Employee.findOne({
            email: email.toLowerCase(),
            organizationId: organizationId,
            userId: { $exists: false },
          });
        }
        
        // If still not found, try case-insensitive email search as fallback
        if (!employee) {
          employee = await Employee.findOne({
            email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
            organizationId: organizationId,
            userId: { $exists: false },
          });
        }
        
        if (employee) {
          // Check if employee already has a userId (prevent duplicates)
          if (employee.userId) {
            return NextResponse.redirect(new URL('/login?error=invitation_already_accepted', request.url));
          }
          employee.userId = user._id;
          if (name) employee.name = name;
          // Ensure organizationId matches (in case of any mismatch)
          if (organizationId && employee.organizationId !== organizationId) {
            employee.organizationId = organizationId;
          }
          // Ensure email is set
          if (!employee.email) {
            employee.email = email.toLowerCase();
          }
          await employee.save();
        }
      } else if (isJoiningExistingOrg) {
        // Check if employee already exists before creating
        const existingEmployee = await Employee.findOne({
          email: email.toLowerCase(),
          organizationId: organizationId,
        });
        
        if (existingEmployee) {
          // Link existing employee to user if not already linked
          if (!existingEmployee.userId) {
            existingEmployee.userId = user._id;
            if (name) existingEmployee.name = name;
            await existingEmployee.save();
          }
        } else {
          // Create new employee record
          await Employee.create({
            name: name || email.split('@')[0],
            role: 'User',
            weeklyHours: 0,
            employeeType: 'full-time',
            userId: user._id,
            organizationId: organizationId,
            email: email.toLowerCase(),
          });
        }
      } else if (!invitationToken) {
        // Check if employee already exists before creating
        const existingEmployee = await Employee.findOne({
          email: email.toLowerCase(),
          organizationId: user._id.toString(),
        });
        if (!existingEmployee) {
          await Employee.create({
            name: name || email.split('@')[0],
            role: 'Administrator',
            weeklyHours: 0,
            employeeType: 'full-time',
            userId: user._id,
            organizationId: user._id.toString(),
          });
        }
      }
    } else {
      // Existing user - update Google info if needed
      let userChanged = false;
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = 'google';
        userChanged = true;
        if (picture && !user.profilePicture) {
          user.profilePicture = picture;
        }
        if (name && !user.name) {
          user.name = name;
        }
      }
      if (!user.emailVerified) {
        user.emailVerified = true;
        user.emailVerificationTokenHash = undefined;
        user.emailVerificationExpires = undefined;
        userChanged = true;
      }
      if (userChanged) {
        await user.save();
      }
    }

    if (effectiveRegistrationApproval(user.registrationApproval) === 'pending') {
      return NextResponse.redirect(new URL('/pending-approval', request.url));
    }
    if (effectiveRegistrationApproval(user.registrationApproval) === 'rejected') {
      return NextResponse.redirect(new URL('/login?error=registration_rejected', request.url));
    }

    // Create session
    await createSession(user._id.toString(), user.email);

    if (isNewUser && user.organizationId) {
      if (invitationToken || isJoiningExistingOrg) {
        syncRegisteredUserToBrevoInBackground({
          email: user.email,
          name: user.name,
          organizationId: user.organizationId,
          userId: user._id.toString(),
        });
      } else {
        syncUserToBrevoInBackground({
          email: user.email,
          name: user.name,
          organizationId: user.organizationId,
          role: 'Administrator',
        });
      }
    }

    // Redirect based on organization setup status
    if (isNewUser && !user.organizationSetupComplete) {
      return NextResponse.redirect(new URL('/setup-organization', request.url));
    }

    return NextResponse.redirect(new URL('/', request.url));
  } catch (error) {
    // Google OAuth callback error
    return NextResponse.redirect(new URL('/login?error=oauth_error', request.url));
  }
}
