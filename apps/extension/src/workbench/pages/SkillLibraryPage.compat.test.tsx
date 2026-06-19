import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillLibraryPage } from "./SkillLibraryPage";

const mocks = vi.hoisted(() => ({
  compileSkill: vi.fn(),
  deleteSkill: vi.fn(),
  getSkillDetail: vi.fn(),
}));

vi.mock("../runtimeApi", () => ({
  runtimeApi: {
    compileSkill: mocks.compileSkill,
    deleteSkill: mocks.deleteSkill,
    getSkillDetail: mocks.getSkillDetail,
  },
}));

describe("SkillLibraryPage detail compatibility", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.compileSkill.mockReset();
    mocks.deleteSkill.mockReset();
    mocks.getSkillDetail.mockReset();
  });

  it("imports Markdown Skill packages as SKILL.md files", async () => {
    mocks.compileSkill.mockResolvedValue({ ok: true, skill: { id: "markdown-skill", name: "Markdown Skill" } });
    const onSkillsChanged = vi.fn();
    const showToast = vi.fn();
    const { container } = render(
      <SkillLibraryPage
        skills={[]}
        onSkillsChanged={onSkillsChanged}
        showToast={showToast}
      />,
    );

    const input = container.querySelector<HTMLInputElement>("input[type='file']")!;
    await userEvent.upload(input, new File(["# Markdown Skill\n\nVoice body."], "voice.md", { type: "text/markdown" }));

    await waitFor(() => {
      expect(mocks.compileSkill).toHaveBeenCalledWith({
        files: { "SKILL.md": "# Markdown Skill\n\nVoice body." },
      });
    });
    expect(onSkillsChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("toast.created");
  });

  it("renders a sparse user Skill detail instead of failing the detail page", async () => {
    mocks.getSkillDetail.mockResolvedValue({
      id: "user-old-skill",
      name: "Old User Skill",
      goal: "Keep the user's imported Skill readable.",
      summary: "Imported before optional detail fields existed.",
      compile_status: "compiled" as const,
    });
    const showToast = vi.fn();

    render(
      <SkillLibraryPage
        skills={[{
          id: "user-old-skill",
          name: "Old User Skill",
          goal: "Keep the user's imported Skill readable.",
          summary: "Imported before optional detail fields existed.",
          compile_status: "compiled",
        }]}
        onSkillsChanged={vi.fn()}
        showToast={showToast}
      />,
    );

    await userEvent.click(screen.getByText("Old User Skill"));

    expect(await screen.findByText("Keep the user's imported Skill readable.")).toBeTruthy();
    await waitFor(() => {
      expect(showToast).not.toHaveBeenCalled();
    });
    expect(screen.queryByText("skills.detailFailed")).toBeNull();
  });

  it("exports loaded Skill detail as a JSON package", async () => {
    const detail = {
      id: "user-skill",
      name: "User Skill",
      goal: "Export this Skill.",
      summary: "Exportable.",
      compile_status: "compiled" as const,
      skill_md: "# User Skill\n\nExport body.",
      sample_outputs: [],
      files: { "SKILL.md": "# User Skill\n\nExport body." },
      manifest: { imported: true },
    };
    mocks.getSkillDetail.mockResolvedValue(detail);
    const createObjectURL = vi.fn((_: Blob) => "blob:skill");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <SkillLibraryPage
        skills={[detail]}
        onSkillsChanged={vi.fn()}
        showToast={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("User Skill"));
    await userEvent.click(await screen.findByText("skills.export"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(readBlobText(blob)).resolves.toContain("\"id\": \"user-skill\"");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:skill");
  });

  it("hides update for built-in Skills", async () => {
    mocks.getSkillDetail.mockResolvedValue({
      id: "full_fire",
      name: "Full Fire",
      goal: "Builtin.",
      summary: "Builtin.",
      compile_status: "builtin",
      skill_md: "# Full Fire",
      sample_outputs: [],
      files: { "SKILL.md": "# Full Fire" },
      manifest: { builtin: true },
    });

    render(
      <SkillLibraryPage
        skills={[{
          id: "full_fire",
          name: "Full Fire",
          goal: "Builtin.",
          summary: "Builtin.",
          compile_status: "builtin",
        }]}
        onSkillsChanged={vi.fn()}
        showToast={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("Full Fire"));
    expect(await screen.findByText("skills.export")).toBeTruthy();
    expect(screen.queryByText("skills.update")).toBeNull();
    expect(screen.queryByText("skills.delete")).toBeNull();
  });

  it("updates non-built-in Skills from an uploaded package", async () => {
    const detail = {
      id: "user-skill",
      name: "User Skill",
      goal: "Update this Skill.",
      summary: "Updateable.",
      compile_status: "compiled" as const,
      skill_md: "# User Skill",
      sample_outputs: [],
      files: { "SKILL.md": "# User Skill" },
      manifest: { imported: true },
    };
    mocks.getSkillDetail.mockResolvedValue(detail);
    mocks.compileSkill.mockResolvedValue({ ok: true, skill: { id: "user-skill", name: "Updated Skill" } });
    const onSkillsChanged = vi.fn();
    const showToast = vi.fn();
    const { container } = render(
      <SkillLibraryPage
        skills={[detail]}
        onSkillsChanged={onSkillsChanged}
        showToast={showToast}
      />,
    );

    await userEvent.click(screen.getByText("User Skill"));
    expect(await screen.findByText("skills.update")).toBeTruthy();
    const inputs = container.querySelectorAll<HTMLInputElement>("input[type='file']");
    const updateInput = inputs[inputs.length - 1];
    await userEvent.upload(updateInput, new File(["# Updated Skill\n\nNew body."], "updated.md", { type: "text/markdown" }));

    await waitFor(() => {
      expect(mocks.compileSkill).toHaveBeenCalledWith({
        skillId: "user-skill",
        files: { "SKILL.md": "# Updated Skill\n\nNew body." },
      });
    });
    expect(onSkillsChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("toast.saved");
  });

  it("deletes non-built-in Skills after confirmation and returns to the list", async () => {
    const detail = {
      id: "user-skill",
      name: "User Skill",
      goal: "Delete this Skill.",
      summary: "Deletable.",
      compile_status: "compiled" as const,
      skill_md: "# User Skill",
      sample_outputs: [],
      files: { "SKILL.md": "# User Skill" },
      manifest: { imported: true },
    };
    mocks.getSkillDetail.mockResolvedValue(detail);
    mocks.deleteSkill.mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const onSkillsChanged = vi.fn();
    const showToast = vi.fn();

    render(
      <SkillLibraryPage
        skills={[detail]}
        onSkillsChanged={onSkillsChanged}
        showToast={showToast}
      />,
    );

    await userEvent.click(screen.getByText("User Skill"));
    await userEvent.click(await screen.findByText("skills.delete"));

    await waitFor(() => {
      expect(mocks.deleteSkill).toHaveBeenCalledWith("user-skill");
    });
    expect(confirm).toHaveBeenCalledWith("skills.deleteConfirm");
    expect(onSkillsChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("toast.deleted");
    expect(screen.queryByText("SKILL.md Preview")).toBeNull();
  });
});

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("blob_read_failed"));
    reader.readAsText(blob);
  });
}
