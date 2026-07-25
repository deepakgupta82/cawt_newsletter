import type { Article } from '@cawt/domain';
import { canonicalizeUrl, publisherFromUrl, titleKey } from '@cawt/domain';
import { createHash } from 'node:crypto';

/**
 * Recorded fixture corpus.
 *
 * These are the articles behind CAWT's real "Wealth & Legacy Watch" edition of
 * 24 Jul 2026, plus deliberate near-misses so relevance filtering has
 * something to actually reject. Capturing a real result set once and replaying
 * it forever is what makes local development free, offline and deterministic.
 *
 * Ages are stored as hours-before-now rather than fixed dates, so the freshness
 * windows keep working whenever the demo is run.
 */

interface Seed {
  url: string;
  title: string;
  hoursAgo: number;
  regions: string[];
  topics: string[];
  snippet: string;
  /** Full text the summariser is allowed to ground itself in. */
  content: string;
  /** Distractors exist to be filtered out. */
  distractor?: boolean;
}

const SEEDS: Seed[] = [
  // ----------------------------------------------------------------- India
  {
    url: 'https://www.reuters.com/business/reliance-industries-quarterly-results-succession-2026-07-20/',
    title: 'Reliance balances multiple pressures as it reports quarterly results',
    hoursAgo: 96,
    regions: ['India'],
    topics: ['succession', 'family business', 'control'],
    snippet:
      'Reuters commentary said Reliance Industries was balancing multiple pressures while reporting quarterly results.',
    content:
      'Reuters commentary published on 20 July said Reliance Industries was balancing multiple pressures while reporting its quarterly results, underscoring why succession and control at India’s best-known business family remains a live wealth-planning topic. Analysts pointed to the group’s capital allocation across telecom, retail and energy, and to the continuing question of how operational control will be distributed among the next generation. No formal change to shareholding or trustee arrangements was announced.',
  },
  {
    url: 'https://developingtelecoms.com/telecom-business/operator-news/jio-platforms-appoints-chief-executive-ahead-of-ipo.html',
    title: 'Jio Platforms appoints new chief executive ahead of planned IPO',
    hoursAgo: 240,
    regions: ['India'],
    topics: ['succession', 'IPO', 'family business'],
    snippet:
      'Jio Platforms appointed a new chief executive ahead of a planned IPO, while Mukesh Ambani is expected to remain chairman.',
    content:
      'A report dated 14 July said Jio Platforms had appointed a new chief executive ahead of a planned initial public offering. Mukesh Ambani is expected to remain chairman and a non-executive director after the listing. The appointment was described as part of a broader professionalisation of management ahead of the IPO, with family members retaining board-level oversight rather than executive roles.',
  },
  {
    url: 'https://www.privateequitywire.co.uk/shapoorji-pallonji-raises-1-6bn-private-credit-deal/',
    title: 'Shapoorji Pallonji raises $1.6 billion in private credit deal',
    hoursAgo: 72,
    regions: ['India'],
    topics: ['family business', 'refinancing', 'control'],
    snippet:
      'Shapoorji Pallonji raised $1.6 billion in a private credit deal and $650 million through a three-year dollar bond.',
    content:
      'Private Equity Wire reported that Shapoorji Pallonji raised $1.6 billion in a private credit deal, and had also raised $650 million through a three-year dollar bond. The report said these transactions are part of a broader fundraising programme and that the group is expected to seek a further $350 million in debt financing over the next six months. The family-controlled group remains in focus for restructuring and control-watch purposes given its longstanding stake in Tata Sons.',
  },
  {
    url: 'https://m.economictimes.com/wealth/legal/will/children-birthright-self-acquired-property-ruling/articleshow/2026071801.cms',
    title: 'Children do not get a birthright in a father’s self-acquired property, court clarifies',
    hoursAgo: 144,
    regions: ['India'],
    topics: ['succession', 'estate planning', 'property'],
    snippet:
      'A recent ruling clarified that children do not get a birthright in a father’s self-acquired property even if received by gift or will.',
    content:
      'The Economic Times reported a recent ruling clarifying that children do not acquire a birthright in a father’s self-acquired property, even where the father himself received that property by gift or under a will. The court held that such property retains its self-acquired character. For estate structuring this matters because the asset can still pass under succession law or under the father’s will, but it is not subject to an automatic coparcenary claim by children during the father’s lifetime.',
  },
  {
    url: 'https://www.livemint.com/companies/adani-family-office-expands-singapore-desk-2026',
    title: 'Adani family office expands its Singapore desk',
    hoursAgo: 30,
    regions: ['India', 'Singapore'],
    topics: ['family office', 'cross-border'],
    snippet: 'The family office arm has added staff in Singapore to manage cross-border holdings.',
    content:
      'A report said the family office arm of a large Indian industrial group has added investment and legal staff to its Singapore desk, citing the need to manage cross-border holdings and succession structures across two jurisdictions. The expansion follows a broader pattern of Indian promoter families establishing substantive presence in Singapore rather than relying on advisers alone.',
  },

  // ------------------------------------------------------------- Singapore
  {
    url: 'https://www.bbc.com/news/world-asia-singapore-ministers-bloomberg-defamation-2026',
    title: 'Singapore ministers win defamation case over bungalow article',
    hoursAgo: 240,
    regions: ['Singapore'],
    topics: ['property', 'trusts', 'reputation'],
    snippet:
      'A Singapore court ordered Bloomberg and a reporter to pay damages to ministers K Shanmugam and Tan See Leng.',
    content:
      'A Singapore court ordered Bloomberg and a reporter to pay damages to ministers K Shanmugam and Tan See Leng over an article about luxury bungalow transactions. The court found the article conveyed a defamatory meaning regarding the propriety of the transactions. The case sits at the intersection of high-value property ownership, trust structures and reputational risk around how elite asset purchases are structured and described in the press.',
  },
  {
    url: 'https://www.forbes.com/sites/singapore-waterfront-site-frasers-top-bid-2026/',
    title: 'Frasers-led group offers top bid for prime Singapore waterfront site',
    hoursAgo: 216,
    regions: ['Singapore'],
    topics: ['property', 'family business', 'dynastic capital'],
    snippet:
      'A Frasers Property-led group linked to Charoen Sirivadhanabhakdi offered the top bid for a prime waterfront site.',
    content:
      'Forbes reported that a Frasers Property-led group linked to billionaire Charoen Sirivadhanabhakdi offered the top bid for a prime Singapore waterfront site. Rival bids came from consortia led by City Developments, tied to Kwek Leng Beng, and UOL Group, controlled by the family of the late Wee Cho Yaw. The bidding underlines the continuing prominence of dynastic capital in Singapore real estate.',
  },
  {
    url: 'https://www.businesstimes.com.sg/wealth/singapore-family-office-incentive-review-2026-07',
    title: 'Singapore reviews family office tax incentive conditions',
    hoursAgo: 20,
    regions: ['Singapore'],
    topics: ['family office', 'tax', 'regulation'],
    snippet:
      'Authorities are reviewing the conditions attached to family office tax incentive schemes, according to people familiar.',
    content:
      'Authorities are reviewing the conditions attached to Singapore’s family office tax incentive schemes, according to people familiar with the discussions. Areas under review are said to include minimum assets under management, local investment requirements and professional headcount. Advisers said any tightening would affect structuring decisions for families currently establishing single family offices in the jurisdiction.',
  },

  // ---------------------------------------------------------- United States
  {
    url: 'https://www.law360.com/articles/caddick-estate-wound-up-after-investors-recoup-funds',
    title: 'Caddick estate wound up after Ponzi scheme investors recoup funds',
    hoursAgo: 18,
    regions: ['United States'],
    topics: ['estate', 'fraud', 'recovery'],
    snippet: 'The Caddick estate was wound up after investors in the Ponzi scheme recouped funds.',
    content:
      'Law360 reported that the Caddick estate was wound up after investors in the Ponzi scheme recouped funds. The report stated that liquidators had completed distributions and that the administration was formally concluded. A figure of $9 million in total recoveries was cited in this report.',
  },
  {
    url: 'https://www.law360.com/articles/caddick-liquidators-report-final-distribution',
    title: 'Caddick liquidators report final distribution to investors',
    hoursAgo: 18,
    regions: ['United States'],
    topics: ['estate', 'fraud', 'recovery'],
    snippet: 'Liquidators reported a final distribution to investors in the Caddick matter.',
    content:
      'Law360 reported that liquidators in the Caddick matter had made a final distribution to investors, bringing the administration to a close. This report cited total recoveries of $1.7 million, a figure that differs from other same-day coverage of the wind-up.',
  },
  {
    url: 'https://news.bloomberglaw.com/employee-benefits/seventh-circuit-retirement-payout-waiver-grandchildren',
    title: 'Seventh Circuit blocks retirement payout plan for doctor’s grandchildren',
    hoursAgo: 72,
    regions: ['United States'],
    topics: ['estate planning', 'retirement', 'beneficiary designation'],
    snippet:
      'A deceased doctor’s $1.2 million retirement payout could not go to trusts benefiting his 36 grandchildren.',
    content:
      'Bloomberg Law reported that a deceased University of Chicago doctor’s $1.2 million retirement payout could not go to trusts benefiting his 36 grandchildren because his widow had not validly waived her rights. The Seventh Circuit said the power of attorney used did not expressly authorize waiving retirement-plan benefits under Wisconsin law. The decision is a reminder that beneficiary designations and waiver formalities can override broader family intent.',
  },
  {
    url: 'https://www.ft.com/content/sumner-redstone-trust-capacity-ruling-background',
    title: 'Sumner Redstone trust capacity ruling remains a reference case',
    hoursAgo: 60,
    regions: ['United States'],
    topics: ['trusts', 'capacity', 'litigation'],
    snippet:
      'A judge ruled in 2019 that Sumner Redstone had capacity to make changes to his trusts, rejecting a challenge.',
    content:
      'The Financial Times noted that a judge ruled in 2019 that media mogul Sumner Redstone had capacity to make changes to his trusts, rejecting a challenge from his former companion. For advisers the matter remains a reference case on capacity evidence in late-life trust amendments rather than an active current contest.',
  },
  {
    url: 'https://news.bloomberglaw.com/business-and-practice/inheritance-disputes-resemble-business-breakups',
    title: 'Inheritance disputes increasingly resemble business breakups',
    hoursAgo: 168,
    regions: ['United States'],
    topics: ['litigation', 'succession', 'closely held business'],
    snippet:
      'Trust and estate disputes are spilling into partnership, corporate governance, contract, tax and real-estate questions.',
    content:
      'Bloomberg Law said trust and estate disputes are increasingly spilling into partnership, corporate governance, contract, tax and real-estate questions as families pass on closely held businesses and illiquid assets. The practical takeaway for private wealth advisers is that succession planning now often needs business-governance documents and valuation discipline, not just wills and trusts.',
  },
  {
    url: 'https://www.sfchronicle.com/realestate/article/california-inherited-property-disputes-heirs-2026.php',
    title: 'California inherited-property disputes rise as heirs become co-owners',
    hoursAgo: 48,
    regions: ['United States'],
    topics: ['property', 'succession', 'probate'],
    snippet:
      'A record 18% of California property transfers occurred through inheritance in 2025, intensifying co-owner disputes.',
    content:
      'Multiple reports said California is seeing rising disputes over inherited real estate as more heirs become co-owners without written agreements. One cited figure said a record 18% of California property transfers occurred through inheritance in 2025. Advisers quoted by the San Francisco Chronicle warned that probate, trustee choice and Proposition 19 tax consequences can intensify sibling conflict.',
  },
  {
    url: 'https://markets.businessinsider.com/news/stocks/california-inheritance-transfers-record-share-2026',
    title: 'Record share of California property transfers came through inheritance',
    hoursAgo: 50,
    regions: ['United States'],
    topics: ['property', 'succession'],
    snippet: 'A record 18% of California property transfers occurred through inheritance in 2025.',
    content:
      'Reporting on California housing data said a record 18% of property transfers in the state occurred through inheritance during 2025, up from prior years. Analysts attributed the shift to an ageing owner population and to Proposition 19 changing the calculus for transferring property during life versus at death.',
  },

  // ------------------------------------------------------------ Distractors
  {
    url: 'https://www.example-jobs.com/careers/private-wealth-associate-mumbai',
    title: 'Hiring: Private Wealth Associate, Mumbai',
    hoursAgo: 12,
    regions: ['India'],
    topics: ['jobs'],
    snippet: 'A leading private bank is hiring a private wealth associate in Mumbai. Apply now.',
    content: 'A leading private bank is hiring a private wealth associate in Mumbai. Competitive package. Apply now.',
    distractor: true,
  },
  {
    url: 'https://www.example-crypto.com/news/token-launch-2026',
    title: 'New token launch draws retail interest',
    hoursAgo: 6,
    regions: ['United States'],
    topics: ['crypto'],
    snippet: 'A new token launch drew significant retail interest this week.',
    content: 'A new token launch drew significant retail interest this week amid volatile trading conditions.',
    distractor: true,
  },
  {
    url: 'https://www.example-sponsored.com/partner/estate-planning-webinar',
    title: 'Sponsored: Free estate planning webinar for advisers',
    hoursAgo: 24,
    regions: ['United States'],
    topics: ['estate planning', 'promotion'],
    snippet: 'Register now for a free sponsored webinar on estate planning best practice.',
    content: 'Register now for a free sponsored webinar on estate planning best practice. Limited seats available.',
    distractor: true,
  },
];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export interface CorpusArticle extends Article {
  /** Full text, held inline for the mock. Real providers put this in Blob. */
  content: string;
}

/** Materialises the corpus with timestamps relative to the moment of the call. */
export function loadCorpus(reference = new Date()): CorpusArticle[] {
  return SEEDS.map((seed) => {
    const url = canonicalizeUrl(seed.url);
    const publishedAt = new Date(reference.getTime() - seed.hoursAgo * 3_600_000).toISOString();
    return {
      id: `art_${hash(url).slice(0, 16)}`,
      canonicalUrl: url,
      title: seed.title,
      publisher: publisherFromUrl(seed.url),
      publishedAt,
      discoveredAt: reference.toISOString(),
      language: 'en',
      regions: seed.regions,
      topics: seed.topics,
      snippet: seed.snippet,
      contentHash: hash(titleKey(seed.title)),
      provider: 'mock',
      content: seed.content,
    } satisfies CorpusArticle;
  });
}
