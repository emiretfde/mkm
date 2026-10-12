let pendingPrompt = null;
let installed = false;
const standalone = () => installed || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const refresh = () => document.querySelectorAll('[data-install-mkm]').forEach(el => { el.hidden = standalone(); });

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  pendingPrompt = event;
  refresh();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  pendingPrompt = null;
  document.querySelector('#mkm-install-help')?.close();
  refresh();
});
window.matchMedia('(display-mode: standalone)').addEventListener('change', refresh);

function showHelp() {
  let dialog = document.querySelector('#mkm-install-help');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'mkm-install-help';
    dialog.className = 'install-dialog';
    dialog.setAttribute('aria-labelledby', 'mkm-install-title');
    dialog.innerHTML = `<img src="/assets/mkm-icon-192.png" alt="Grb FK MKM" width="64" height="64"><h2 id="mkm-install-title">MKM na tvom telefonu</h2><p>Dodaj MKM na početni ekran i otvaraj ga kao aplikaciju.</p><h3>iPhone · Safari</h3><ol><li>Otvori MKM u Safariju.</li><li>Pritisni <b>Podijeli</b>, pa <b>Dodaj na početni ekran</b>.</li><li>Ako postoji opcija <b>Otvori kao web aplikaciju</b>, uključi je i pritisni <b>Dodaj</b>.</li></ol><h3>Android · Chrome</h3><ol><li>Otvori MKM u Chromeu.</li><li>U meniju <b>⋮</b> izaberi <b>Instaliraj i napravi prečicu</b>, pa <b>Instaliraj</b>, ili <b>Dodaj na početni ekran</b>.</li><li>Potvrdi dodavanje.</li></ol><p class="muted">Ako si link otvorio iz poruke, prvo ga otvori u Safariju ili Chromeu. Za rad sa evidencijom potreban je internet.</p><form method="dialog"><button>Zatvori</button></form>`;
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    document.body.append(dialog);
  }
  if (!dialog.open) dialog.showModal();
}

export function mountInstall(target) {
  if (!target || target.querySelector('[data-install-mkm]')) return;
  const area = document.createElement('div');
  area.dataset.installMkm = '';
  area.className = 'install-mkm';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = 'Dodaj MKM na telefon';
  button.addEventListener('click', async () => {
    if (standalone()) return;
    if (!pendingPrompt) return showHelp();
    const prompt = pendingPrompt;
    pendingPrompt = null;
    button.disabled = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      showHelp();
    } finally {
      button.disabled = false;
      refresh();
    }
  });
  area.append(button);
  target.append(area);
  refresh();
}
