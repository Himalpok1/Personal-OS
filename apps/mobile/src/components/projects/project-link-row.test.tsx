import { describe, expect, it, vi } from "vitest";
import { ProjectLinkRow } from "./project-link-row";

describe("ProjectLinkRow", () => {
  it("renders nothing when there is no project", () => {
    expect(ProjectLinkRow({ projectId: null, projects: [], onPress: vi.fn() })).toBeNull();
    expect(ProjectLinkRow({ projectId: undefined, projects: [], onPress: vi.fn() })).toBeNull();
  });

  it("shows the project's name and navigates on tap", () => {
    const onPress = vi.fn();
    const el = ProjectLinkRow({
      projectId: "p1",
      projects: [{ id: "p1", name: "Kitchen remodel" }],
      onPress,
    }) as any;
    expect(el.props.title).toBe("Project: Kitchen remodel");
    expect(el.props.chevron).toBe(true);
    el.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("shows a generic label rather than blank when the project list hasn't loaded yet", () => {
    const el = ProjectLinkRow({ projectId: "p1", projects: undefined, onPress: vi.fn() }) as any;
    expect(el.props.title).toBe("Project: Project");
  });
});
