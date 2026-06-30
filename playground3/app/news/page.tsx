import NewsDigest from '../components/NewsDigest';

export const metadata = {
  title: 'AI News Digest · YayaAgent',
  description: 'Enter any topic. The agent searches today\'s news, summarizes with AI, and emails you a concise briefing.',
};

export default function NewsPage() {
  return <NewsDigest />;
}
