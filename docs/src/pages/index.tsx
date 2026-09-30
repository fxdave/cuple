import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import TypeSafetyDemo from "../components/TypeSafetyDemo";
import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/server/installation">
            Get started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            href="https://stackblitz.com/~/github.com/fxdave/react-express-cuple-boilerplate/tree/stackblitz?file=backend/src/index.ts"
          >
            Try it in StackBlitz
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="Typesharing between frontend and backends made easy. The missing type-safety for full-stack."
    >
      <TypeSafetyDemo />
      <HomepageHeader />
    </Layout>
  );
}
