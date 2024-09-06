import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import ReactPlayer from "react-player";
import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <p className="hero__subtitle">{siteConfig.tagline}</p>
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
      <ReactPlayer
        playing
        controls
        url="example.mp4"
        loop
        width="100vw"
        height="min(calc(100vh - 60px), 56.25vw)"
      />
      <HomepageHeader />
    </Layout>
  );
}
