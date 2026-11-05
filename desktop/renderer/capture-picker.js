const list = document.getElementById('sources');
const share = document.getElementById('share');
let selected = null;

function card(source) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'source';
  button.setAttribute('aria-pressed', 'false');
  if (source.thumbnail) {
    const image = document.createElement('img');
    image.src = source.thumbnail;
    image.alt = '';
    button.append(image);
  } else {
    const blank = document.createElement('div');
    blank.className = 'blank';
    button.append(blank);
  }
  const name = document.createElement('span');
  name.textContent = source.name;
  name.title = source.name;
  button.append(name);
  button.addEventListener('click', () => {
    selected = source.id;
    share.disabled = false;
    for (const other of list.querySelectorAll('.source')) other.setAttribute('aria-pressed', String(other === button));
  });
  button.addEventListener('dblclick', () => void window.capturePicker.choose(source.id));
  return button;
}

function section(title, sources) {
  if (!sources.length) return;
  const heading = document.createElement('h2');
  heading.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.append(...sources.map(card));
  list.append(heading, grid);
}

share.addEventListener('click', () => { if (selected) void window.capturePicker.choose(selected); });
document.getElementById('cancel').addEventListener('click', () => void window.capturePicker.choose(null));
document.addEventListener('keydown', event => { if (event.key === 'Escape') void window.capturePicker.choose(null); });

void window.capturePicker.sources().then(sources => {
  list.replaceChildren();
  if (!sources.length) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Windows did not offer any screens or windows to share.';
    list.append(note);
    return;
  }
  section('Screens', sources.filter(source => source.screen));
  section('Windows', sources.filter(source => !source.screen));
});
