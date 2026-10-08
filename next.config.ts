import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pure-JS libs that read/zip files: load from node_modules instead of bundling.
  serverExternalPackages: ["pptx-automizer", "pptxgenjs", "jszip", "exceljs"],
  // The slimmed brand template is read from disk at runtime; make sure it is traced into the functions.
  outputFileTracingIncludes: {
    "/api/export": ["./src/lib/render/assets/**/*"],
    // export_weekly_deck runs inside the MCP route too.
    "/api/mcp/[secret]": ["./src/lib/render/assets/**/*"],
  },
};

export default nextConfig;
