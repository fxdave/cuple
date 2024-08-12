import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import ReactPlayer from 'react-player'
import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="Typesharing between frontend and backends made easy. The missing type-safety for full-stack.">
      <HomepageHeader />
      <ReactPlayer playing controls url='https://private-user-images.githubusercontent.com/12275699/296619052-a9486ab2-6d61-467b-acd2-1a9acc6b6de0.mp4?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MjM0OTg5MzgsIm5iZiI6MTcyMzQ5ODYzOCwicGF0aCI6Ii8xMjI3NTY5OS8yOTY2MTkwNTItYTk0ODZhYjItNmQ2MS00NjdiLWFjZDItMWE5YWNjNmI2ZGUwLm1wND9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNDA4MTIlMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjQwODEyVDIxMzcxOFomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPWMwMDgzNTM1MTVlMmNjY2UwZGE1NzQ2YWNiNTcyZmU0ZDhjM2ViZDEzY2I0MGVhMWY1ZjkxMTUyZjhlNDg4MGImWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0JmFjdG9yX2lkPTAma2V5X2lkPTAmcmVwb19pZD0wIn0.-mt6gLB41g1oR25eOeNE-YLCRqK6cqXPWsT17hXF1fA' />
    </Layout>
  );
}
