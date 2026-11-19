import { MetadataRoute } from 'next';

/** App/authenticated areas — not marketing. Everything else is crawlable. */
const DISALLOW_PATHS = [
  '/api/',
  '/admin',
  '/setup-organization',
  '/billing',
  '/uploads/',
  '/os',
  '/recording/',
] as const;

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nucleas.app';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...DISALLOW_PATHS],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
