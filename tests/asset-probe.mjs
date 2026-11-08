const projectId = 'd8dbebd1-2cf7-4e9c-b965-3e363c459545';
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE3sAAAAASUVORK5CYII=';
const projectsResponse = await fetch('http://127.0.0.1:4181/api/projects');
const projects = await projectsResponse.json();
console.log(JSON.stringify({ projectExists: projects.some((project) => project.id === projectId), projectIds: projects.map((project) => project.id).slice(0, 4) }));
const response = await fetch('http://127.0.0.1:4181/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, name: 'probe.png', dataUrl, width: 1, height: 1 }) });
console.log(JSON.stringify({ status: response.status, body: await response.text() }));
