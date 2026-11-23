const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("App root element not found");
}

app.innerHTML = `
  <main class="page">
    <header class="page__header">
      <p class="eyebrow">Transit data</p>
      <h1>GTFS Viewer</h1>
      <p class="intro">A simple place to explore General Transit Feed Specification data.</p>
    </header>
    <section class="panel" aria-labelledby="welcome-heading">
      <h2 id="welcome-heading">Welcome</h2>
      <p>The viewer is ready for a GTFS feed.</p>
    </section>
  </main>
`;
