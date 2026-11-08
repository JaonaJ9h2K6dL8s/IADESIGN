export type Language = 'fr' | 'en';

const messages = {
  fr: {
    workspace: 'Espace de travail', files: 'Fichiers', home: 'Accueil', projects: 'Projets', recent: 'Récents',
    design: 'Design', uploads: 'Importations', text: 'Texte', elements: 'Éléments', background: 'Arrière-plan',
    layers: 'Calques', properties: 'Propriétés', canvas: 'Format du document', width: 'Largeur', height: 'Hauteur',
    position: 'Position', size: 'Dimensions', rotation: 'Rotation', color: 'Couleur', opacity: 'Opacité',
    addText: 'Ajouter un titre', addBody: 'Ajouter un texte', addShape: 'Formes', upload: 'Importer des fichiers',
    uploadHint: 'Glissez-déposez vos images ici, ou parcourez vos fichiers.', arrange: 'Mise en page magique',
    export: 'Exporter', exportPng: 'Image PNG', exportSvg: 'Fichier SVG', exportPdf: 'Imprimer / PDF',
    saved: 'Enregistré', saving: 'Enregistrement…', unsaved: 'Modifications', addPage: 'Nouveau projet',
    undo: 'Annuler', redo: 'Rétablir', delete: 'Supprimer', lock: 'Verrouiller', unlock: 'Déverrouiller',
    hide: 'Masquer', show: 'Afficher', chooseImage: 'Choisir des images', noSelection: 'Sélectionnez un élément pour le modifier.',
    pages: 'Pages', zoom: 'Zoom', backgroundColor: 'Fond du document', layoutTip: 'Vos objets seront répartis harmonieusement sur la page.',
    smartTitle: 'Composition équilibrée', useLayout: 'Appliquer', cancel: 'Annuler', untitled: 'Sans titre',
    exportReady: 'Votre export est prêt.', duplicated: 'Copie créée', emptyLayers: 'Aucun élément pour le moment',
    askAi: 'Assistant de création', assistantHint: 'Décrivez l’ambiance de votre prochain visuel.',
    writePrompt: 'Ex. affiche botanique minimaliste', generate: 'Créer une composition', nameProject: 'Nom du projet',
    newDesign: 'Nouveau design', poster: 'Affiche', label: 'Étiquette', social: 'Réseaux sociaux', print: 'Impression',
    selectTool: 'Sélectionner', duplicate: 'Dupliquer', center: 'Centrer', quickLayouts: 'Mises en page', more: 'Plus',
    workspaces: 'Mes créations', newWorkspace: 'Nouveau design', aiLabel: 'STUDIO CRÉATIF', dpi: '300 DPI',
  },
  en: {
    workspace: 'Workspace', files: 'Files', home: 'Home', projects: 'Projects', recent: 'Recent',
    design: 'Design', uploads: 'Uploads', text: 'Text', elements: 'Elements', background: 'Background',
    layers: 'Layers', properties: 'Properties', canvas: 'Document size', width: 'Width', height: 'Height',
    position: 'Position', size: 'Dimensions', rotation: 'Rotation', color: 'Color', opacity: 'Opacity',
    addText: 'Add a heading', addBody: 'Add body text', addShape: 'Shapes', upload: 'Upload files',
    uploadHint: 'Drag and drop images here, or browse your files.', arrange: 'Magic layout',
    export: 'Export', exportPng: 'PNG image', exportSvg: 'SVG file', exportPdf: 'Print / PDF',
    saved: 'Saved', saving: 'Saving…', unsaved: 'Changes', addPage: 'New project',
    undo: 'Undo', redo: 'Redo', delete: 'Delete', lock: 'Lock', unlock: 'Unlock',
    hide: 'Hide', show: 'Show', chooseImage: 'Choose images', noSelection: 'Select an element to edit it.',
    pages: 'Pages', zoom: 'Zoom', backgroundColor: 'Background color', layoutTip: 'Your objects will be arranged evenly across the page.',
    smartTitle: 'Balanced composition', useLayout: 'Apply', cancel: 'Cancel', untitled: 'Untitled',
    exportReady: 'Your export is ready.', duplicated: 'Copy created', emptyLayers: 'No elements yet',
    askAi: 'Design assistant', assistantHint: 'Describe the look and feel of your next design.',
    writePrompt: 'e.g. minimalist botanical poster', generate: 'Create a composition', nameProject: 'Project name',
    newDesign: 'New design', poster: 'Poster', label: 'Label', social: 'Social', print: 'Print',
    selectTool: 'Select', duplicate: 'Duplicate', center: 'Center', quickLayouts: 'Layouts', more: 'More',
    workspaces: 'My designs', newWorkspace: 'New design', aiLabel: 'CREATIVE STUDIO', dpi: '300 DPI',
  },
} as const;

export function useStrings(language: Language) {
  return (key: keyof typeof messages.fr) => messages[language][key] ?? messages.fr[key];
}
