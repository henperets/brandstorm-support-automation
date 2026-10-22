// Special environments - kept as manual entries with custom aliases
const BRANDS = [
  {
    id: "sandbox-demo",
    displayName: "Sandbox Demo",
    url: "https://sandbox-demo.nimbus.example/login",
    aliases: ["sandbox-demo", "sandbox", "demo"],
  },
  {
    id: "prod",
    displayName: "Production",
    url: "https://prod.nimbus.example/login",
    aliases: ["prod", "production", "prd"],
  },
  {
    id: "staging",
    displayName: "Staging",
    url: "https://staging.nimbus.example",
    aliases: ["staging", "uat", "stg"],
  },
];

// All active organizations - auto-generated from admin panel
// NOTE: this is illustrative sample data (fictional company names), not the
// real customer list, to keep this portfolio repo free of any real client data.
const _ORG_LIST = [
  "northwind-traders","contoso-retail","fabrikam-goods","wide-world-importers",
  "tailspin-toys","woodgrove-market","woodgrove-bank","litware-insurance",
  "humongous-insurance","vanarsdel-capital","relecloud-mobile","blue-yonder-telecom",
  "fourth-coffee-health","lucerne-health-network","alpine-care-clinics",
  "city-of-rivertown","metro-transit-authority","blue-yonder-airlines",
  "margies-travel","trey-airlines","consolidated-messenger","northwind-logistics",
  "graphic-design-institute","proseware-media","adventure-works-tech",
  "coho-winery-systems","first-up-consultants","school-of-fine-art",
  "wingtip-toys","nod-publishers","fabrikam-fiber","contoso-pharma",
  "northwind-electronics","litware-motors","fabrikam-airlines-charter",
  "wide-world-importers-eu","tailspin-toys-au","proseware-print",
  "coho-vineyard-retail","relecloud-events","humongous-retail-group",
  "vanarsdel-real-estate","woodgrove-utilities","litware-games",
  "fabrikam-shipping","contoso-university","northwind-university",
  "adatum-corp","fourth-coffee-roasters","alpineskihouse","trey-research",
  "city-power-and-light-demo","best-for-you-organics","the-phone-company-demo",
  "wingtip-toys-online","sandbox-2","load-test-org","internal-qa",
  "onboarding-team-demo","training-org","vendor-pilot-1","vendor-pilot-2",
  "free-trial-1","free-trial-2","staging-mirror","beta-partner-1",
  "beta-partner-2","chatbot-demo","automation-course-demo","delete-old-account-1",
  "delete-old-account-2","legacy-crm-migrated","partner-integration-test",
  "qa-automation-suite","demo-en","demo-he","test-brand-1","test-brand-2",
];

_ORG_LIST.forEach((id) => {
  const slug = id.toLowerCase().replace(/ /g, "-");
  const display = id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  BRANDS.push({
    id,
    displayName: display,
    url: `https://${slug}.nimbus.example/login`,
    aliases: [...new Set([id.toLowerCase(), slug])],
    builtIn: true,
  });
});
