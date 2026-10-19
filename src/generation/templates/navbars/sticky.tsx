'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface StickyNavbarProps {
  className?: string;
  brand?: string;
  links?: Array<{ label: string; href: string }>;
  cta?: { label: string; href: string };
}

const DEFAULT_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'About', href: '#about' },
];

export function StickyNavbar({ className, brand = 'Morph', links = DEFAULT_LINKS, cta = { label: 'Get Started', href: '#' } }: StickyNavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className={cn('sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60', className)}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold">{brand}</Link>
        <div className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <a key={link.label} href={link.href} className="text-sm text-muted-foreground hover:text-foreground">{link.label}</a>
          ))}
          <a href={cta.href} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">{cta.label}</a>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden" aria-label="Toggle menu">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            {mobileOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            }
          </svg>
        </button>
      </nav>
      {mobileOpen && (
        <div className="border-t px-4 py-4 md:hidden">
          {links.map((link) => (
            <a key={link.label} href={link.href} className="block py-2 text-sm text-muted-foreground">{link.label}</a>
          ))}
          <a href={cta.href} className="mt-2 block rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground">{cta.label}</a>
        </div>
      )}
    </header>
  );
}
