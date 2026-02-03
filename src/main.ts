import './style.css'; // Optional global styles
import {fileService} from './lib/file-service';
import './components/pdf-workspace';

// Simple Router / State
const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div id="drop-zone" class="drop-zone">
    <h1>Open Waqf Signer</h1>
    <p>Secure, Offline, Free.</p>
    <button id="btn-open">Open PDF</button>
    <p class="sub">or drag file here</p>
  </div>
  <pdf-workspace id="workspace" style="display:none"></pdf-workspace>
`;

const dropZone = document.getElementById('drop-zone')!;
const workspace = document.getElementById('workspace') as any;
const btnOpen = document.getElementById('btn-open')!;

// Handle File Loading
async function handleFile(data: Uint8Array, name: string) {
    dropZone.style.display = 'none';
    workspace.style.display = 'block';
    await workspace.loadPdf(data, name);
}

btnOpen.addEventListener('click', async () => {
    try {
        const data = await fileService.openPdf();
        handleFile(data, 'document.pdf');
    } catch (e) {
        console.error(e); // Cancelled
    }
});

// Drag and Drop support (Web)
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
    e.preventDefault();
    if (e.dataTransfer?.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type === 'application/pdf') {
            const buffer = await file.arrayBuffer();
            handleFile(new Uint8Array(buffer), file.name);
        }
    }
});