// Example data for the product previews on the landing page (from the Figma
// mockups). It shows what the UI looks like; it is never presented as real
// usage numbers (PRODUCT.md: no invented numbers on public pages).

export const LIVE_JOB = {
  from: "Hamburg",
  to: "Lyon",
  sourceCompany: "Krone Logistics",
  destCompany: "TREE-ET",
  cargo: "Electronics",
  massT: 18.4,
  truck: "Volvo FH16",
  plannedKm: 1196,
  drivenKm: 742,
  speedKmh: 84,
  damagePct: 1.2,
  eta: "6 h 10 min",
  income: "€ 52 400",
};

export const LEADERBOARD = [
  { name: "Kasper", rank: "Legend", km: 24310, jobs: 51, income: "€ 2.31 M", color: "#3b3129" },
  {
    name: "Dev",
    rank: "Senior Driver",
    km: 18940,
    jobs: 42,
    income: "€ 1.84 M",
    color: "#f5a524",
    you: true,
  },
  { name: "Ingrid", rank: "Veteran", km: 17205, jobs: 39, income: "€ 1.62 M", color: "#1e7d4b" },
  {
    name: "TruckerTom",
    rank: "Veteran",
    km: 15880,
    jobs: 33,
    income: "€ 1.49 M",
    color: "#137a6d",
  },
  { name: "Sofie", rank: "Driver", km: 12410, jobs: 28, income: "€ 1.10 M", color: "#2f63c4" },
];

export const EVENTS = [
  {
    day: 15,
    month: "NOV",
    title: "Friday Night Convoy",
    game: "ETS2",
    meta: "Simulation 1 · 20:00",
    route: "Hamburg → Rotterdam",
    going: 18,
  },
  {
    day: 17,
    month: "NOV",
    title: "Route 66 Run",
    game: "ATS",
    meta: "US · 19:00",
    route: "Barstow → Kingman",
    going: 11,
  },
  {
    day: 22,
    month: "NOV",
    title: "Nordic Tour",
    game: "ETS2",
    meta: "Simulation 2 · 18:30",
    route: "Oslo → Stockholm",
    going: 64,
    public: true,
  },
] as const;

export const ROUTES = [
  { from: "Hamburg", to: "Lyon", game: "ETS2", cargo: "Electronics" },
  { from: "Oslo", to: "Malmö", game: "ETS2", cargo: "Fresh fish" },
  { from: "Barstow", to: "Kingman", game: "ATS", cargo: "Lumber" },
  { from: "Calais", to: "Paris", game: "ETS2", cargo: "Furniture" },
  { from: "Berlin", to: "Praha", game: "ETS2", cargo: "Steel coils" },
  { from: "Seattle", to: "Portland", game: "ATS", cargo: "Logs" },
  { from: "Milano", to: "Wien", game: "ETS2", cargo: "Tractors" },
  { from: "Bergen", to: "Oslo", game: "ETS2", cargo: "Salmon" },
  { from: "Los Angeles", to: "Phoenix", game: "ATS", cargo: "Produce" },
  { from: "Rotterdam", to: "Hamburg", game: "ETS2", cargo: "Containers" },
] as const;

export const GOAL = {
  title: "250 000 km together",
  target: 250000,
  done: 160112,
  yourShare: 18940,
};

const nf = new Intl.NumberFormat("en-GB");
/** "24 310" style grouping, as in the designs. */
export const km = (n: number) => `${nf.format(n).replace(/,/g, " ")} km`;
