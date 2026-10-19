import { WorkspaceShell } from "@/components/shell/WorkspaceShell";

/**
 * The shell lives here rather than in the page: a page under a dynamic segment
 * remounts whenever its params change, which would reset the shell's state
 * (navigator open, inline rename) on every canvas switch.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkspaceShell />
      {children}
    </>
  );
}
