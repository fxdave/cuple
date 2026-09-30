import { useLocation } from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import DropdownNavbarItem from "@theme/NavbarItem/DropdownNavbarItem";
import { useEffect, useState } from "react";

/**
 * Picks a docs version. The list is read from the site's `versions.json` when
 * the page loads, not when it's built, so the docs of an old version still
 * list the versions released after it.
 */
export default function VersionsNavbarItem(props: { mobile?: boolean; position?: "left" | "right" }) {
  const { siteConfig } = useDocusaurusContext();
  const { siteRoot, docsVersion } = siteConfig.customFields as {
    siteRoot: string;
    docsVersion: string | null;
  };
  const { pathname } = useLocation();
  const [versions, setVersions] = useState<number[] | null>(null);

  useEffect(() => {
    fetch(`${siteRoot}versions.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then(setVersions, () => setVersions(null));
  }, [siteRoot]);

  // Local builds aren't in a version folder, and have nothing to switch to.
  if (!docsVersion || !versions?.length) return null;
  const latest = Math.max(...versions);
  // The same page in the other version; if it doesn't exist there, the site's
  // 404 page sends you to that version's home.
  const page = pathname.slice(siteConfig.baseUrl.length);
  return (
    <DropdownNavbarItem
      {...props}
      label={`v${docsVersion}`}
      items={versions.map((version) => ({
        label: version === latest ? `v${version} (latest)` : `v${version}`,
        href: `pathname://${siteRoot}v${version}/${page}`,
        target: "_self",
        autoAddBaseUrl: false,
      }))}
    />
  );
}
