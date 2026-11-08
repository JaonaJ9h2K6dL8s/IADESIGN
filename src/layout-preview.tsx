import type { DesignProject } from './types';

export function LayoutPreview({ project }: { project: DesignProject }) {
  return <div className="layout-preview" style={{ aspectRatio: `${project.width} / ${project.height}` }}>
    <div className="layout-preview-background" style={{ background: project.background ?? '#f6f5f1' }} />
    {project.nodes.filter((node) => node.visible).map((node) => <span key={node.id} style={{
      left: `${node.x / project.width * 100}%`,
      top: `${node.y / project.height * 100}%`,
      width: `${node.width / project.width * 100}%`,
      height: `${node.height / project.height * 100}%`,
      background: node.type === 'text' ? 'transparent' : node.fill,
      color: node.type === 'text' ? node.fill : undefined,
      opacity: node.opacity,
      borderRadius: node.type === 'ellipse' ? '50%' : undefined,
      transform: `rotate(${node.rotation}deg)`,
    }}>{node.type === 'text' ? node.text?.slice(0, 30) : node.type === 'image' && node.src ? <img src={node.src} alt=""/> : null}</span>)}
  </div>;
}
