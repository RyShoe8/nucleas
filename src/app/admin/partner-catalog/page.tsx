'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface PartnerLink {
  name: string;
  url?: string;
  productType?: string;
  description?: string;
}

interface Catalog {
  name: string;
  partnerLinks: PartnerLink[];
  productTypes: string[];
}

export default function PartnerCatalogPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const res = await fetch('/api/admin/partner-catalog');
        if (res.status === 403) {
          setError('Access denied. Admin privileges required.');
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setCatalog({
          name: data.name || 'Default',
          partnerLinks: data.partnerLinks || [],
          productTypes: data.productTypes || [],
        });
      } catch {
        setError('Failed to load partner catalog');
      } finally {
        setLoading(false);
      }
    };
    fetchCatalog();
  }, []);

  const handleSave = async () => {
    if (!catalog) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/partner-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setCatalog({
        name: data.name || 'Default',
        partnerLinks: data.partnerLinks || [],
        productTypes: data.productTypes || [],
      });
    } catch {
      alert('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addPartnerLink = () => {
    setCatalog((prev) =>
      prev
        ? {
            ...prev,
            partnerLinks: [...prev.partnerLinks, { name: '', url: '', productType: '', description: '' }],
          }
        : null
    );
  };

  const updatePartnerLink = (index: number, field: keyof PartnerLink, value: string) => {
    setCatalog((prev) => {
      if (!prev) return null;
      const updated = [...prev.partnerLinks];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, partnerLinks: updated };
    });
  };

  const removePartnerLink = (index: number) => {
    setCatalog((prev) =>
      prev ? { ...prev, partnerLinks: prev.partnerLinks.filter((_, i) => i !== index) } : null
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl mx-auto">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl mx-auto">
          <Card className="p-6">
            <p className="text-error mb-4">{error}</p>
            <Link href="/admin">
              <Button>Back to Admin</Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/admin" className="text-text-secondary hover:text-primary transition-colors">
            ← Back to Admin
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-text-primary mb-2">Smart Button Catalog</h1>
        <p className="text-text-secondary mb-6">
          Manage partner links that can be suggested when adding Smart Buttons to projects. Projects can also add custom buttons directly.
        </p>

        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Partner Links</h2>
          <p className="text-sm text-text-secondary mb-4">
            Pre-defined tools (hosting, analytics, docs, etc.) that appear as suggestions when adding Smart Buttons to a project.
          </p>
          {catalog?.partnerLinks.map((link, index) => (
            <div key={index} className="flex flex-wrap gap-2 mb-4 p-4 border border-border rounded-lg items-end">
              <div className="flex-1 min-w-[120px]">
                <Input
                  placeholder="Label (e.g. Vercel)"
                  value={link.name}
                  onChange={(e) => updatePartnerLink(index, 'name', e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[180px]">
                <Input
                  placeholder="URL"
                  value={link.url || ''}
                  onChange={(e) => updatePartnerLink(index, 'url', e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[100px]">
                <Input
                  placeholder="Type (e.g. hosting)"
                  value={link.productType || ''}
                  onChange={(e) => updatePartnerLink(index, 'productType', e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => removePartnerLink(index)}
                className="text-error hover:underline text-sm shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addPartnerLink}>
            + Add Partner Link
          </Button>
        </Card>

        <div className="flex gap-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Catalog'}
          </Button>
          <Link href="/admin">
            <Button variant="secondary">Cancel</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
