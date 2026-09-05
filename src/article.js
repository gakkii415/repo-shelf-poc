const back = document.querySelector('#back');
const from = new URLSearchParams(location.search).get('from');
if (back && from) {
  try {
    const candidate = new URL(from, location.origin);
    const home = new URL(back.href);
    if (candidate.origin === home.origin && [home.pathname,home.pathname+'index.html'].includes(candidate.pathname)) back.href = candidate.href;
  } catch {}
}
