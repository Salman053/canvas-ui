import type { Metadata } from "next";

import { ComponentDoc } from "@/components/docs/component-doc";
import { Footer } from "@/components/landing/footer";
import type { ApiProp } from "@/components/docs/api-reference";
import { getComponentSources } from "@/lib/registry";
import { highlight } from "@/components/docs/highlight";
import { HologramDemo } from "@/demos/hologram-demo";
import { DemoImageSection } from "@/demos/demo-image-cycler";

export const metadata: Metadata = {
  title: "Hologram",
  description:
    "Wraps your content in a canvas using the html-in-canvas API and projects it as a volumetric holographic display with cursor-tracking scanlines, RGB fringing, projection warp, power fluctuation, and dust particles. No dependencies, works in any framework.",
  alternates: { canonical: "/docs/components/hologram" },
};

const DESCRIPTION =
  "A volumetric holographic projection that scans across this page. The effect follows your cursor: scanlines warp around it, content bends toward it, and fast movements trigger tracking glitch artifacts. Tune every layer. This page is the demo.";

const API_REFERENCE: ApiProp[] = [
  {
    name: "intensity",
    description: "Overall strength of the hologram effect (0 to 3).",
    type: "number",
    defaultValue: "1",
  },
  {
    name: "speed",
    description: "Speed of the floating dust, power fluctuation, and animation.",
    type: "number",
    defaultValue: "0.6",
  },
  {
    name: "scanlines",
    description: "Density of vertical scanlines (1 to 40). Lower is chunkier.",
    type: "number",
    defaultValue: "18",
  },
  {
    name: "rgbShift",
    description: "Chromatic RGB fringing in CSS pixels (0 to 20).",
    type: "number",
    defaultValue: "3",
  },
  {
    name: "flicker",
    description: "Power fluctuation / flicker amount (0 to 1).",
    type: "number",
    defaultValue: "0.2",
  },
  {
    name: "tint",
    description: "Cyan/blue tint mix (0 to 1).",
    type: "number",
    defaultValue: "0.5",
  },
  {
    name: "opacity",
    description: "Overall opacity of the hologram overlay (0 to 1).",
    type: "number",
    defaultValue: "0.8",
  },
  {
    name: "warp",
    description:
      "Projection warp strength: how much content bends toward the cursor (0 to 20).",
    type: "number",
    defaultValue: "6",
  },
  {
    name: "glitch",
    description:
      "How intensely the hologram glitches on fast cursor movement (0 to 1).",
    type: "number",
    defaultValue: "0.4",
  },
  {
    name: "follow",
    description:
      "How smoothly the hologram follows the cursor (0 to 1). 1 snaps to it immediately.",
    type: "number",
    defaultValue: "0.18",
  },
  {
    name: "className",
    description: "Classes applied to the wrapper element.",
    type: "string",
  },
];

export default async function HologramPage() {
  const variants = await Promise.all(
    getComponentSources("hologram").map(async (file) => ({
      id: file.id,
      label: file.label,
      fileName: file.fileName,
      source: file.source,
      html: await highlight(file.source, file.lang),
    })),
  );

  return (
    <HologramDemo>
      <ComponentDoc
        title="Hologram"
        description={DESCRIPTION}
        variants={[...variants]}
        installItem="hologram"
        tags={["html-in-canvas"]}
        requiresHtmlInCanvas
        apiReference={API_REFERENCE}
        beforeInstall={
          <DemoImageSection
            hint="Photos make the scanlines, RGB fringing, projection warp, and dust particles easy to see. Move your cursor quickly to trigger glitch artifacts."
            alt="Demo photo for the Hologram effect"
          />
        }
      />
      <div className="mx-auto mt-24 w-full max-w-3xl">
        <Footer variant="docs" />
      </div>
    </HologramDemo>
  );
}
