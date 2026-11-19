interface StructuredDataProps {
  type: 'Organization' | 'WebSite' | 'WebPage' | 'SoftwareApplication' | 'FAQPage' | 'BreadcrumbList' | 'BlogPosting' | 'Blog' | 'HowTo';
  data: Record<string, unknown>;
}

export function StructuredData({ type, data }: StructuredDataProps) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': type,
    ...data,
  };

  return (
    <script
      type="application/ld+json"
      // Escaped so text such as a blog title containing "</script>" can never close the tag early.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026') }}
    />
  );
}
