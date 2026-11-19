import { Schema, Types } from 'mongoose';

export type SocialNetwork =
  | 'x'
  | 'linkedin'
  | 'instagram'
  | 'tiktok'
  | 'reddit'
  | 'bluesky'
  | 'youtube'
  | 'facebook'
  | 'github'
  | 'other';

export interface IProjectSocialLink {
  network: SocialNetwork;
  url: string;
  login?: string;
}

export type TechStackCategory = string;

export interface IProjectTechStackItem {
  category: TechStackCategory;
  technologyId: string;
  login?: string;
}

export type MarketingStackCategory = string;

export interface IProjectMarketingStackItem {
  category: MarketingStackCategory;
  toolId: string;
  login?: string;
}

export interface IPlatformStackItem {
  category: string;
  optionId: string;
  login?: string;
}

export type ProjectActionButtonKind = 'link' | 'email';

export interface IProjectActionButton {
  label: string;
  url: string;
  referralSourceId?: Types.ObjectId;
  kind?: ProjectActionButtonKind;
}

const SOCIAL_NETWORK_ENUM = [
  'x',
  'linkedin',
  'instagram',
  'tiktok',
  'reddit',
  'bluesky',
  'youtube',
  'facebook',
  'github',
  'other',
] as const;

export const socialLinksSchemaDefinition = {
  type: [
    {
      network: {
        type: String,
        enum: SOCIAL_NETWORK_ENUM,
        required: true,
      },
      url: { type: String, trim: true, required: true },
      login: { type: String, trim: true },
    },
  ],
  default: [],
};

export const techStackSchemaDefinition = {
  type: [
    {
      category: {
        type: String,
        required: true,
        trim: true,
      },
      technologyId: { type: String, trim: true, required: true },
      login: { type: String, trim: true },
    },
  ],
  default: [],
};

export const marketingStackSchemaDefinition = {
  type: [
    {
      category: {
        type: String,
        required: true,
        trim: true,
      },
      toolId: { type: String, trim: true, required: true },
      login: { type: String, trim: true },
    },
  ],
  default: [],
};

export const platformStacksSchemaDefinition = {
  type: Schema.Types.Mixed,
  default: {},
};

export const actionButtonsSchemaDefinition = [
  {
    label: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    referralSourceId: { type: Schema.Types.ObjectId, ref: 'PartnerCatalog' },
    kind: {
      type: String,
      enum: ['link', 'email'],
      default: 'link',
    },
  },
];

/** Shared operational fields for Client and Project. */
export interface IPlatformOperationsFields {
  url?: string;
  urls?: string[];
  devUrl?: string;
  liveUrl?: string;
  socialLinks?: IProjectSocialLink[];
  socialsToolbarVisible?: boolean;
  techStack?: IProjectTechStackItem[];
  marketingStack?: IProjectMarketingStackItem[];
  platformStacks?: Record<string, IPlatformStackItem[]>;
  colorPalette?: string[];
  fontPalette?: string[];
  logo?: string;
  actionButtons?: IProjectActionButton[];
  clientPortalSlug?: string;
  clientPortalToken?: string;
  invitedClientEmails?: string[];
}

export const platformOperationsSchemaFields = {
  url: { type: String, trim: true },
  urls: { type: [String], default: [] },
  devUrl: { type: String, trim: true },
  liveUrl: { type: String, trim: true },
  socialLinks: socialLinksSchemaDefinition,
  socialsToolbarVisible: { type: Boolean, default: true },
  techStack: techStackSchemaDefinition,
  marketingStack: marketingStackSchemaDefinition,
  platformStacks: platformStacksSchemaDefinition,
  colorPalette: { type: [String], default: undefined },
  fontPalette: { type: [String], default: undefined },
  actionButtons: actionButtonsSchemaDefinition,
  clientPortalSlug: { type: String, trim: true },
  clientPortalToken: { type: String, trim: true },
  invitedClientEmails: { type: [String], default: [] },
};
