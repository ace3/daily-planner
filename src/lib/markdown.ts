export function taskToMarkdown(task: import('../types/task').Task): string {
  const status = task.status === 'review' ? '[x]' : '[ ]';
  const priority = task.priority === 1 ? '🔴' : task.priority === 2 ? '🟡' : '🟢';
  let md = `- ${status} ${priority} **${task.title}**`;
  if (task.estimated_min) md += ` _(est. ${task.estimated_min}m)_`;
  if (task.actual_min) md += ` _(actual: ${task.actual_min}m)_`;
  if (task.notes) md += `\n  > ${task.notes.replace(/\n/g, '\n  > ')}`;
  return md;
}
