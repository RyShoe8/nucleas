'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { BLOG_NAME } from '@/lib/blog/blogConstants';
import { COMMUNITY_SOCIAL_LINKS } from '@/lib/constants/communitySocialLinks';
import RecaptchaNotice from '@/components/recaptcha/RecaptchaNotice';
import { PAGE_GUTTER_CLASS } from '@/lib/ui/mobileLayout';

const freeToolLinks = [
  { href: '/tools', label: 'All Free Tools' },
  { href: '/tools/screenshot', label: 'Screenshot Tool' },
];

const companyLinks = [
  { href: '/about', label: 'About' },
  { href: '/blog', label: BLOG_NAME },
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Contact' },
  { href: '/contact?type=Feature Request', label: 'Request a Feature' },
];

const socialLinkIcons: Record<string, ReactNode> = {
  Discord: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  ),
  Bluesky: (
    <svg className="h-5 w-5" viewBox="0 0 320 286" fill="currentColor" aria-hidden>
      <path d="M69.3642 19.1462C108.497 -7.66514 146.852 46.1818 160 83.1558C173.148 46.1818 211.503 -7.66514 250.636 19.1462C279.792 39.1171 289.866 75.3129 283.821 110.155C278.36 141.624 256.096 166.452 225.854 174.652C216.32 177.236 201.272 178.691 196.536 179.351C194.276 179.666 195.968 180.377 197.809 181.166C227.426 193.864 246.602 223.111 239.544 255.437C231.258 293.385 194.398 294.027 163.666 266.38C161.424 264.364 160 260.67 160 260.67C160 260.67 158.576 264.364 156.334 266.38C125.602 294.027 88.7423 293.385 80.4557 255.437C73.3983 223.111 92.5738 193.864 122.191 181.166C124.032 180.377 125.724 179.666 123.464 179.351C118.728 178.691 103.68 177.236 94.1457 174.652C63.9042 166.452 41.6401 141.624 36.1793 110.155C30.1343 75.3129 40.2078 39.1171 69.3642 19.1462Z" />
    </svg>
  ),
  Reddit: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.03 4.875-6.77 4.875-3.74 0-6.771-2.181-6.771-4.875 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  ),
};

const socialLinks = COMMUNITY_SOCIAL_LINKS.map((link) => ({
  ...link,
  icon: socialLinkIcons[link.label],
}));

const legalLinks = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
];

export default function Footer() {
  return (
    <footer className="relative z-[60] bg-background border-t border-white/10 mt-auto pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
      <div className={`max-w-7xl mx-auto ${PAGE_GUTTER_CLASS} py-12 md:py-16`}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-10 lg:gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-4 lg:col-span-2">
            <Link href="/" className="inline-block mb-4">
              <img
                src="/images/nucleas-logo.png?v=6"
                alt="Nucleas"
                width={140}
                height={48}
                className="h-10 w-auto object-contain"
              />
            </Link>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mb-4">
              The smart operating system for building and running a business. Build. Organize. Operate.
            </p>
            <p className="text-slate-500 text-xs mb-4">
              Not another project manager — the business management layer that brings it all together.
            </p>
            <div className="flex items-center gap-3">
              {socialLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-all hover:scale-110"
                  style={{
                    color: link.color,
                    borderColor: `${link.color}40`, // 25% opacity for border
                    backgroundColor: `${link.color}10`, // 6% opacity for bg
                  }}
                >
                  {link.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Free Tools */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Free Tools</h3>
            <ul className="space-y-3">
              {freeToolLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-400 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Company</h3>
            <ul className="space-y-3">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-400 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">Legal</h3>
            <ul className="space-y-3">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-slate-400 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10">
          <p className="text-xs text-slate-500 leading-relaxed max-w-3xl mb-4">
            Some links on this site are affiliate links. If you sign up or purchase through them, we may earn a
            commission at no additional cost to you. This helps support Nucleas.
          </p>
          <RecaptchaNotice className="text-xs text-slate-500 leading-relaxed max-w-3xl mb-6" />
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-slate-500">
              © {new Date().getFullYear()} Nucleas. All rights reserved. Built by{' '}
              <a
                href="https://themediashop.co"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors"
              >
                TheMediaShop.co
              </a>
            </p>
            <a
              href="mailto:theteam@nucleas.app"
              className="text-sm text-slate-500 hover:text-slate-400 transition-colors"
            >
              theteam@nucleas.app
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
