import { useState } from 'react';
import { Pencil, X, Plus } from 'lucide-react';
import { useUpdateFile } from '@/hooks/useKnowledge';
import { Tag, type TagColor } from '@/components/primitives/Tag';

const stageLabels: Record<number, string> = {
  1: 'Capture', 2: 'Triage', 3: 'Research', 4: 'Synthesis', 5: 'Decision', 6: 'Expertise',
};
const stageColors: Record<number, TagColor> = {
  1: 'gray', 2: 'yellow', 3: 'blue', 4: 'purple', 5: 'green', 6: 'orange',
};

interface FrontmatterEditorProps {
  path: string;
  stage?: number;
  tags: string[];
}

export function FrontmatterEditor({ path, stage: initialStage, tags: initialTags }: FrontmatterEditorProps) {
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState(initialStage ?? 1);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [newTag, setNewTag] = useState('');
  const updateFile = useUpdateFile();

  const handleSave = () => {
    updateFile.mutate(
      { path, update: { frontmatter: { stage, tags } } },
      { onSuccess: () => setEditing(false) },
    );
  };

  const handleCancel = () => {
    setStage(initialStage ?? 1);
    setTags(initialTags);
    setNewTag('');
    setEditing(false);
  };

  const addTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  // Display mode
  if (!editing) {
    return (
      <div className="group/editor flex items-center gap-2 flex-wrap">
        {initialStage && (
          <Tag
            label={stageLabels[initialStage] || `Stage ${initialStage}`}
            color={stageColors[initialStage] || 'gray'}
            size="sm"
          />
        )}
        {initialTags.map(tag => (
          <Tag key={tag} label={tag} color="gray" size="sm" />
        ))}
        <button
          onClick={() => setEditing(true)}
          className="p-1 rounded-[5px] text-text-quaternary hover:text-text hover:bg-hover transition-colors cursor-pointer opacity-0 group-hover/editor:opacity-100"
          style={{ transitionDuration: '80ms' }}
          title="Edit metadata"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="rounded-[7px] border border-border-secondary bg-bg-secondary p-4 space-y-4">
      {/* Stage Selector */}
      <div>
        <p className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-2">Stage</p>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6].map(s => {
            const isActive = s === stage;
            return (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={`px-2.5 h-7 rounded-[5px] text-[11px] font-[510] border transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-accent/15 text-accent border-accent/30'
                    : 'bg-bg-tertiary text-text-tertiary border-transparent hover:border-border-secondary hover:text-text-secondary'
                }`}
                style={{ transitionDuration: '80ms' }}
              >
                {stageLabels[s]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags Editor */}
      <div>
        <p className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary mb-2">Tags</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 h-6 rounded-xs bg-tag-gray-bg text-tag-gray text-[11px] font-medium"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="p-0.5 rounded-xs hover:bg-red/10 hover:text-red transition-colors cursor-pointer"
                style={{ transitionDuration: '80ms' }}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <div className="inline-flex items-center h-6">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(); }
              }}
              placeholder="Add tag..."
              className="w-20 h-6 text-[11px] bg-transparent text-text-secondary placeholder:text-text-quaternary outline-none border-b border-border-secondary focus:border-accent transition-colors"
              style={{ transitionDuration: '80ms' }}
            />
            <button
              onClick={addTag}
              className="p-1 text-text-quaternary hover:text-accent transition-colors cursor-pointer"
              style={{ transitionDuration: '80ms' }}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={updateFile.isPending}
          className="px-3 h-7 rounded-[5px] text-[11px] font-[510] text-white bg-accent hover:bg-accent/90 transition-colors cursor-pointer disabled:opacity-50"
          style={{ transitionDuration: '80ms' }}
        >
          {updateFile.isPending ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          className="px-3 h-7 rounded-[5px] text-[11px] font-[510] text-text-tertiary hover:text-text hover:bg-hover transition-colors cursor-pointer"
          style={{ transitionDuration: '80ms' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
