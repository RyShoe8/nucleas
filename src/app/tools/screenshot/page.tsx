import type { Metadata } from 'next';
import Link from 'next/link';
import PublicScreenshotTool from '@/components/tools/PublicScreenshotTool';
import MarketingFaq from '@/components/marketing/MarketingFaq';
import AnimateIn from '@/components/home/AnimateIn';
import { StructuredData } from '@/components/StructuredData';
import { SCREENSHOT_TOOL_FAQ } from '@/data/screenshotToolFaq';

const baseUrl = process.env.NEXTAUTH_URL || 'https://nucleas.app';
const pageUrl = `${baseUrl}/tools/screenshot`;
const pageTitle = 'Free Screenshot Tool — Capture & Download in Your Browser';
const pageDescription =
  'Free online screenshot tool — capture your browser tab or screen, select an area, and download a PNG locally. No account, no install, no upload required.';

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  keywords: [
    'free screenshot tool',
    'online screenshot',
    'screen capture browser',
    'screenshot download',
    'capture screen online',
    'no signup screenshot',
    'PNG screenshot',
    'area screenshot',
  ],
  alternates: { canonical: '/tools/screenshot' },
  openGraph: {
    title: `${pageTitle} | Nucleas`,
    description: pageDescription,
    url: pageUrl,
    type: 'website',
    siteName: 'Nucleas',
    images: [
      {
        url: '/images/nucleas-logo.png',
        width: 512,
        height: 512,
        alt: 'Nucleas free screenshot tool',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${pageTitle} | Nucleas`,
    description: pageDescription,
    images: ['/images/nucleas-logo.png'],
  },
};

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Choose a capture mode',
    description:
      'Pick full window capture or drag to select a region. You can also upload an existing image file.',
  },
  {
    step: '2',
    title: 'Share a tab or window',
    description:
      'Your browser asks which screen, window, or tab to share — the same trusted picker used for video calls.',
  },
  {
    step: '3',
    title: 'Name and download',
    description:
      'Give your screenshot a filename and download a PNG to your computer. Nothing leaves your device unless you sign in to save to Nucleas.',
  },
];

const FEATURES = [
  {
    title: 'Full window capture',
    description:
      'Grab everything visible in the tab or window you share — perfect for full-page reviews and documentation.',
  },
  {
    title: 'Area selection',
    description:
      'Draw a rectangle over the shared content when you only need part of the screen for bug reports or cropped assets.',
  },
  {
    title: 'Local download',
    description:
      'Files stay on your machine in the free tool. No cloud upload, no account, and no browser extension required.',
  },
  {
    title: 'Upload & rename',
    description:
      'Already have an image? Upload it, name the file, and download a clean PNG without leaving the page.',
  },
  {
    title: 'Privacy first',
    description:
      'Captures are processed in your browser. We do not store free-tool downloads on Nucleas servers.',
  },
  {
    title: 'Upgrade to workspace',
    description:
      'Sign in to attach screenshots to projects, tasks, and your team asset library inside Nucleas.',
  },
];

const USE_CASES = [
  {
    title: 'Bug reports & QA',
    description: 'Capture UI issues with precise area selection and share PNGs with your engineering team.',
  },
  {
    title: 'Design reviews',
    description: 'Screenshot components, flows, or marketing pages without installing another app.',
  },
  {
    title: 'Documentation',
    description: 'Illustrate help articles, SOPs, and internal guides with crisp browser captures.',
  },
  {
    title: 'Social & content',
    description: 'Crop highlights for posts, thumbnails, and content planning without a separate editor.',
  },
];

const faqSchemaMainEntity = SCREENSHOT_TOOL_FAQ.map((item) => ({
  '@type': 'Question',
  name: item.question,
  acceptedAnswer: { '@type': 'Answer', text: item.answer },
}));

export default function PublicScreenshotToolPage() {
  return (
    <div className="min-h-screen bg-background">
      <StructuredData
        type="BreadcrumbList"
        data={{
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: baseUrl },
            { '@type': 'ListItem', position: 2, name: 'Free Tools', item: `${baseUrl}/tools` },
            { '@type': 'ListItem', position: 3, name: 'Screenshot Tool', item: pageUrl },
          ],
        }}
      />
      <StructuredData
        type="SoftwareApplication"
        data={{
          name: 'Nucleas Free Screenshot Tool',
          applicationCategory: 'UtilitiesApplication',
          operatingSystem: 'Web',
          url: pageUrl,
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
            description: 'Free browser screenshot capture and local PNG download',
          },
          description: pageDescription,
          featureList: [
            'Full window screen capture',
            'Drag-to-select area capture',
            'Local PNG download',
            'Image file upload',
            'No account required',
            'Optional save to Nucleas workspace',
          ],
          publisher: { '@type': 'Organization', name: 'Nucleas', url: baseUrl },
        }}
      />
      <StructuredData type="FAQPage" data={{ mainEntity: faqSchemaMainEntity }} />
      <StructuredData
        type="HowTo"
        data={{
          name: 'How to capture a screenshot with Nucleas',
          description: 'Capture a browser tab or window and download a PNG locally using the free Nucleas screenshot tool.',
          step: HOW_IT_WORKS.map((item, index) => ({
            '@type': 'HowToStep',
            position: index + 1,
            name: item.title,
            text: item.description,
          })),
        }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden px-4 sm:px-6 lg:px-8 py-16 md:py-24 border-b border-border">
        <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />
        <div className="absolute top-1/4 -right-32 w-[400px] h-[400px] rounded-full bg-accent/10 blur-[100px] pointer-events-none" />
        <div className="relative max-w-4xl mx-auto text-center">
          <AnimateIn>
            <Link
              href="/tools"
              className="inline-block text-sm text-text-secondary hover:text-primary mb-6"
            >
              ← All free tools
            </Link>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-sm font-medium text-accent mb-6">
              Free tool
            </span>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight mb-6">
              Free screenshot tool{' '}
              <span className="bg-gradient-to-r from-accent to-nucleas-fourth bg-clip-text text-transparent">
                for your browser
              </span>
            </h1>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              Capture a tab, window, or screen region and download a PNG locally. No account, no
              install, and no upload — use it instantly, or sign up to save captures inside your
              Nucleas workspace.
            </p>
          </AnimateIn>
        </div>
      </section>

      {/* Tool */}
      <section className="px-4 sm:px-6 lg:px-8 py-10 md:py-14 border-b border-border">
        <div className="max-w-xl mx-auto rounded-2xl border border-border bg-background-card p-6 md:p-8 shadow-lg shadow-black/10">
          <PublicScreenshotTool />
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 sm:px-6 lg:px-8 py-20 md:py-24 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">How it works</h2>
              <p className="text-text-secondary max-w-2xl mx-auto">
                Three steps from capture to download — all in your browser.
              </p>
            </div>
          </AnimateIn>
          <div className="grid md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((item, index) => (
              <AnimateIn key={item.step} delay={index * 80}>
                <div className="relative bg-background-card border border-border rounded-2xl p-6 h-full">
                  <span className="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-primary/15 text-primary font-bold text-lg mb-4">
                    {item.step}
                  </span>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{item.description}</p>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 sm:px-6 lg:px-8 py-20 md:py-24 bg-background-card/50 border-b border-border">
        <div className="max-w-6xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                Built for fast, private captures
              </h2>
              <p className="text-text-secondary max-w-2xl mx-auto">
                Everything you need for quick screenshots without another browser extension.
              </p>
            </div>
          </AnimateIn>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature, index) => (
              <AnimateIn key={feature.title} delay={index * 60}>
                <div className="bg-background-card border border-border rounded-2xl p-6 hover:border-accent/30 transition-all duration-300 hover:translate-y-[-2px] h-full">
                  <h3 className="text-base font-semibold text-text-primary mb-2">{feature.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{feature.description}</p>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="px-4 sm:px-6 lg:px-8 py-20 md:py-24 border-b border-border">
        <div className="max-w-6xl mx-auto">
          <AnimateIn>
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">Popular use cases</h2>
              <p className="text-text-secondary max-w-2xl mx-auto">
                Teams and solo builders use the free screenshot tool for everyday capture workflows.
              </p>
            </div>
          </AnimateIn>
          <div className="grid sm:grid-cols-2 gap-6">
            {USE_CASES.map((item, index) => (
              <AnimateIn key={item.title} delay={index * 80}>
                <div className="flex gap-4 rounded-2xl border border-border bg-background-card p-6">
                  <span className="text-2xl shrink-0" aria-hidden>
                    ✦
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-text-primary mb-2">{item.title}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{item.description}</p>
                  </div>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* Compare */}
      <section className="px-4 sm:px-6 lg:px-8 py-20 md:py-24 bg-background-card/50 border-b border-border">
        <div className="max-w-4xl mx-auto">
          <AnimateIn>
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-nucleas-fourth flex items-center justify-center text-2xl">
                ⚡
              </div>
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-text-primary mb-4">
                  Why Nucleas instead of another extension?
                </h2>
                <p className="text-text-secondary leading-relaxed mb-4">
                  Browser extensions ask for broad permissions, add toolbar clutter, and often sync
                  captures to third-party servers. Nucleas gives you a free in-browser tool with
                  local downloads — and when you are ready, the same capture flow lives inside your
                  workspace linked to projects and tasks.
                </p>
                <p className="text-text-secondary leading-relaxed">
                  Explore{' '}
                  <Link href="/register" className="text-primary hover:underline">
                    built-in Nucleas tools
                  </Link>{' '}
                  for recordings, smart buttons, and task-linked assets, or{' '}
                  <Link href="/pricing" className="text-primary hover:underline">
                    compare plans
                  </Link>{' '}
                  when your team needs more than one-off downloads.
                </p>
              </div>
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* Upgrade CTA */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 md:py-20 border-b border-border">
        <div className="max-w-4xl mx-auto relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent/10 via-nucleas-fourth/10 to-primary/10 border border-accent/20 p-10 md:p-16 text-center">
          <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" />
          <div className="relative">
            <h2 className="text-3xl font-bold text-text-primary mb-4">
              Save screenshots where your team works
            </h2>
            <p className="text-text-secondary mb-8 max-w-xl mx-auto">
              Sign up for Nucleas to attach captures to projects, tasks, and content — so bug
              reports, design feedback, and documentation stay in context.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/register"
                className="inline-flex items-center px-8 py-4 rounded-xl bg-primary text-nucleas-ink font-semibold text-lg hover:bg-primary-hover transition-all shadow-lg shadow-primary/25"
              >
                Start your free trial
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center px-8 py-4 rounded-xl border border-border text-text-primary font-semibold text-lg hover:border-primary/40 transition-all"
              >
                See workspace tools
              </Link>
            </div>
          </div>
        </div>
      </section>

      <MarketingFaq
        id="screenshot-faq"
        badge="FAQ"
        heading="Screenshot tool questions"
        subtitle="Privacy, browser support, file formats, and saving to your workspace."
        items={SCREENSHOT_TOOL_FAQ}
        variant="dark"
      />

      {/* Related links */}
      <section className="px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="max-w-3xl mx-auto flex flex-wrap justify-center gap-4">
          <Link
            href="/tools"
            className="px-6 py-3 rounded-xl border border-border text-text-secondary hover:text-primary hover:border-primary/30 transition-all text-sm font-medium"
          >
            All free tools →
          </Link>
          <Link
            href="/register"
            className="px-6 py-3 rounded-xl border border-border text-text-secondary hover:text-primary hover:border-primary/30 transition-all text-sm font-medium"
          >
            Built-in OS tools →
          </Link>
          <Link
            href="/register"
            className="px-6 py-3 rounded-xl border border-border text-text-secondary hover:text-primary hover:border-primary/30 transition-all text-sm font-medium"
          >
            Create account →
          </Link>
        </div>
      </section>
    </div>
  );
}
