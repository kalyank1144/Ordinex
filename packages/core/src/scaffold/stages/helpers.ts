/**
 * Stage Helpers — Shared utility functions used by multiple stages.
 *
 * Contains blueprint route helpers, stub page generation, and package manager detection.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AppBlueprint } from '../blueprintSchema';

export function ensureBlueprintRoutesExist(
  projectPath: string,
  blueprint: AppBlueprint,
  hasSrcDir: boolean,
  publishedFiles: string[],
  LOG_PREFIX: string,
): number {
  const prefix = hasSrcDir ? 'src/' : '';
  let stubsCreated = 0;

  for (const page of blueprint.pages) {
    const routePath = page.path === '/' ? '' : page.path;
    const pageTsxRelative = `${prefix}app${routePath}/page.tsx`;
    const pageTsxAbsolute = path.join(projectPath, pageTsxRelative);

    if (fs.existsSync(pageTsxAbsolute)) {
      if (routePath === '') {
        try {
          const content = fs.readFileSync(pageTsxAbsolute, 'utf-8');
          if (content.includes('Get started by editing') || content.includes('next/font/google')) {
            console.log(`${LOG_PREFIX} [STUBS] Overwriting default Next.js page.tsx at root`);
          } else {
            continue;
          }
        } catch { continue; }
      } else {
        continue;
      }
    }

    if (publishedFiles.some(f => f.includes(`app${routePath}/page.tsx`))) {
      continue;
    }

    const dir = path.dirname(pageTsxAbsolute);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const stubContent = generateStubPage(page, blueprint);
    fs.writeFileSync(pageTsxAbsolute, stubContent, 'utf-8');
    stubsCreated++;
    console.log(`${LOG_PREFIX} [STUBS] Created stub page: ${pageTsxRelative}`);
  }

  return stubsCreated;
}

function generateStubPage(
  page: AppBlueprint['pages'][0],
  _blueprint: AppBlueprint,
): string {
  const hasForm = page.key_components.some(c =>
    /form|input|create|add|edit|new/i.test(c)
  );
  const hasTable = page.key_components.some(c =>
    /table|list|grid|view/i.test(c)
  );

  const componentList = page.key_components.slice(0, 5).map(c =>
    `            <div className="rounded-lg border p-4">\n              <p className="font-medium">${c}</p>\n              <p className="text-sm text-muted-foreground">Component placeholder</p>\n            </div>`
  ).join('\n');

  let extraImports = '';
  let extraContent = '';

  if (hasForm) {
    extraImports = '\nimport { Input } from "@/components/ui/input";\nimport { Label } from "@/components/ui/label";';
    extraContent = `
          <div className="grid gap-4 max-w-md">
            <div className="grid gap-2">
              <Label htmlFor="field1">Name</Label>
              <Input id="field1" placeholder="Enter name..." />
            </div>
            <Button>Submit</Button>
          </div>`;
  }

  if (hasTable) {
    extraContent += `
          <div className="rounded-lg border">
            <div className="p-4 border-b bg-muted/50">
              <p className="font-medium text-sm">Items</p>
            </div>
            <div className="p-8 text-center text-muted-foreground text-sm">
              No items yet. Create your first item to get started.
            </div>
          </div>`;
  }

  return `'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";${extraImports}

export default function ${page.name.replace(/[^a-zA-Z0-9]/g, '')}Page() {
  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">${page.name}</h1>
          <p className="text-muted-foreground">${page.description || `Manage your ${page.name.toLowerCase()}`}</p>
        </div>
        <Button>New</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>${page.name}</CardTitle>
          <CardDescription>${page.description || `View and manage ${page.name.toLowerCase()}`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
${extraContent || `          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">\n${componentList}\n          </div>`}
        </CardContent>
      </Card>
    </div>
  );
}
`;
}

export function detectPackageManager(projectPath: string): 'npm' | 'pnpm' | 'yarn' {
  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}
