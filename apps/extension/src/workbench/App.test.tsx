import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtensionMessage } from "../api/handlers";
import { resetExtensionDataForTests } from "../api/idbStore";
import { App } from "./App";

type CapturedMessage = { type: string; payload?: unknown };

describe("Workbench App", () => {
  const messages: CapturedMessage[] = [];
  const openedTabs: string[] = [];
  let seededBoxId = 0;
  let storage: Map<string, unknown>;

  beforeEach(async () => {
    messages.length = 0;
    openedTabs.length = 0;
    storage = new Map();
    resetExtensionDataForTests();

    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Workbench should use chrome.runtime.sendMessage, not fetch");
    }));

    const sendMessage = vi.fn((message: CapturedMessage, callback?: (response: unknown) => void) => {
      const run = async () => {
        messages.push({ type: message.type, payload: message.payload });
        try {
          const data = await handleExtensionMessage(message as never);
          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "unknown_extension_error" };
        }
      };
      if (callback) {
        void run().then(callback);
        return undefined;
      }
      return run();
    });

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
      storage: {
        local: {
          get: vi.fn(async (key: string | string[] | Record<string, unknown>) => {
            if (typeof key === "string") return { [key]: storage.get(key) };
            if (Array.isArray(key)) {
              return Object.fromEntries(key.map((item) => [item, storage.get(item)]));
            }
            return Object.fromEntries(Object.keys(key).map((item) => [item, storage.get(item) ?? key[item]]));
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items)) storage.set(key, value);
          }),
          remove: vi.fn(async (key: string) => {
            storage.delete(key);
          }),
        },
      },
      tabs: {
        create: vi.fn(async ({ url }: { url: string }) => {
          openedTabs.push(url);
          return { id: 100 + openedTabs.length, url };
        }),
      },
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
      },
    });

    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "知乎大V素材", description: "回答与文章", platform: "zhihu" },
    });
    seededBoxId = box.id;
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: seededBoxId,
        entries: [
          { source: "zhihu", content: "样例素材一，先讲证据再讲态度。", metadata: {} },
          { source: "zhihu", content: "样例素材二，别把情绪包装成论证。", metadata: {} },
          { source: "zhihu", content: "样例素材三，跳步结论要追回前提。", metadata: {} },
        ],
      },
    });

    await handleExtensionMessage({
      type: "skills:compile",
      payload: {
        files: {
          "manifest.json": JSON.stringify({ id: "draft-skill", name: "Draft Skill", skill_name: "draft-skill", goal: "creator goal", version: "0.1.0" }),
          "SKILL.md": [
            "---",
            "name: draft-skill",
            "description: Use when creator goal",
            "---",
            "",
            "# Draft Skill",
            "",
            "creator goal",
          ].join("\n"),
          "style_profile.json": JSON.stringify({ tone: "direct" }),
          "attack_playbook.json": JSON.stringify(fixedAttackPlaybook({ moves: ["classify"] })),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
  });

  it("renders the sidebar brand and 4 main navigation tabs", () => {
    render(<App />);

    expect(screen.getByText("工作台")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "素材箱" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "技能工坊" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "技能库" })).toBeTruthy();
  });

  it("shows settings page and extension status by default", async () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: "设置", selected: true })).toBeTruthy();
    expect(screen.getByText("设置", { selector: ".page-header__title" })).toBeTruthy();
    expect(await screen.findByText(/clapback-extension v0.1.0/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("navigates between pages when clicking tabs", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "素材箱" }));
    expect(screen.getByText("素材箱", { selector: ".page-header__title" })).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "技能工坊" }));
    expect(screen.getByText("技能工坊", { selector: ".page-header__title" })).toBeTruthy();
  });

  it("expands sub-nav when clicking 技能库", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("tab", { name: "技能库" }));
    expect(screen.getByRole("tab", { name: "技将" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "弹药箱" })).toBeTruthy();
    expect(screen.getByText("技将", { selector: ".page-header__title" })).toBeTruthy();
  });

  it("toggles between light and dark themes", async () => {
    render(<App />);

    const toggle = screen.getByRole("button", { name: /切换主题/ });
    expect(document.documentElement.dataset.theme).toBe("light");

    await userEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "settings:save",
        payload: expect.objectContaining({ theme: "dark" }),
      }));
    });
  });

  it("saves language preference through the background API", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("radio", { name: "EN" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "settings:save",
        payload: expect.objectContaining({ language: "en" }),
      }));
    });
  });

  it("saves the configured Skill tryout round count through the background API", async () => {
    render(<App />);

    const rounds = await screen.findByLabelText("试打轮次");
    await userEvent.click(rounds);
    await userEvent.keyboard("{Control>}a{/Control}5");
    await userEvent.click(screen.getByRole("button", { name: "保存试打轮次" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "settings:save",
        payload: expect.objectContaining({ skill_tryout_rounds: 5 }),
      }));
    });
  });

  it("saves model config through the background API without dynamic host permission prompts", async () => {
    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "添加模型配置" });
    await userEvent.click(addButtons[0]);
    await userEvent.type(screen.getByLabelText("模型名称"), "gpt-test");
    const baseUrl = screen.getByLabelText("默认 URL");
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, "https://api.openai.com/v1");
    await userEvent.type(screen.getByLabelText("API Key"), "sk-1234567890");
    await userEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "models:save",
        payload: expect.objectContaining({
          model_name: "gpt-test",
          base_url: "https://api.openai.com/v1",
          api_key: "sk-1234567890",
        }),
      }));
    });
    expect(chrome.permissions?.request).not.toHaveBeenCalled();
    expect(chrome.permissions?.contains).not.toHaveBeenCalled();
  });

  it("saves custom provider model config even when optional host permission is unavailable", async () => {
    const containsPermission = chrome.permissions?.contains as unknown as { mockResolvedValueOnce: (value: boolean) => void };
    const requestPermission = chrome.permissions?.request as unknown as { mockResolvedValueOnce: (value: boolean) => void };
    containsPermission.mockResolvedValueOnce(false);
    requestPermission.mockResolvedValueOnce(false);

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "添加模型配置" });
    await userEvent.click(addButtons[0]);
    await userEvent.selectOptions(screen.getByLabelText("模型厂商"), "Custom");
    await userEvent.type(screen.getByLabelText("自定义厂商"), "Qwen Bailian");
    await userEvent.type(screen.getByLabelText("模型名称"), "qwen-plus");
    const baseUrl = screen.getByLabelText("默认 URL");
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
    await userEvent.type(screen.getByLabelText("API Key"), "sk-qwen-1234567890");
    await userEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "models:save",
        payload: expect.objectContaining({
          provider: "Qwen Bailian",
          model_name: "qwen-plus",
          base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          api_key: "sk-qwen-1234567890",
        }),
      }));
    });
    expect(chrome.permissions?.contains).not.toHaveBeenCalled();
    expect(chrome.permissions?.request).not.toHaveBeenCalled();
  });

  it("detects models in the config modal and fills a selected model", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: "qwen-plus" }, { id: "qwen-max" }] }),
        };
      }
      if (url.endsWith("/chat/completions")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "pong" } }] }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "添加模型配置" });
    await userEvent.click(addButtons[0]);
    await userEvent.selectOptions(screen.getByLabelText("模型厂商"), "Qwen DashScope");
    await userEvent.type(screen.getByLabelText("API Key"), "sk-qwen-1234567890");
    await userEvent.click(screen.getByRole("button", { name: "检测模型" }));
    await userEvent.click(await screen.findByRole("button", { name: "qwen-plus" }));

    expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe("qwen-plus");

    await userEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText("连接成功")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("prefills OpenCode Go with DeepSeek V4 Flash as the default model", async () => {
    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "添加模型配置" });
    await userEvent.click(addButtons[0]);
    await userEvent.selectOptions(screen.getByLabelText("模型厂商"), "OpenCode Go");

    expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe("deepseek-v4-flash");
    expect((screen.getByLabelText("默认 URL") as HTMLInputElement).value).toBe("https://opencode.ai/zen/go/v1");
    expect((screen.getByLabelText("接口协议") as HTMLSelectElement).value).toBe("openai_chat");
  });

  it("tests a saved model connection from the model table", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const addButtons = await screen.findAllByRole("button", { name: "添加模型配置" });
    await userEvent.click(addButtons[0]);
    await userEvent.type(screen.getByLabelText("模型名称"), "gpt-test");
    await userEvent.type(screen.getByLabelText("API Key"), "sk-1234567890");
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(await screen.findByText("gpt-test")).toBeTruthy();

    await userEvent.click(await screen.findByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "models:test",
        payload: { id: 1 },
      }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("starts creator collection by opening the profile tab and binding the target corpus", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "素材箱" }));
    await userEvent.click(screen.getByRole("button", { name: "新建素材箱" }));
    await userEvent.click(screen.getByText("系统爬取"));
    await userEvent.type(screen.getByPlaceholderText("例如 罗翔的知乎"), "新爬取箱");
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.queryByLabelText("知乎 Cookie")).toBeNull();
    expect(screen.getByText("尚未抓到内容：如何开始采风")).toBeTruthy();
    expect(screen.getByText("来源页打开后，采风工具条只扫描当前已经加载出来的内容。")).toBeTruthy();
    expect(document.querySelector(".crawl-empty-guide__head svg")).toBeTruthy();
    expect(document.querySelector(".crawl-empty-guide__copy")?.textContent).toContain("尚未抓到内容");
    await userEvent.type(screen.getByPlaceholderText("https://www.zhihu.com/people/xxxx"), "https://www.zhihu.com/people/example");
    await userEvent.click(screen.getByRole("button", { name: "开始爬取" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "collection:startSession",
        payload: expect.objectContaining({
          platform: "zhihu",
          creator_url: "https://www.zhihu.com/people/example",
          requested_count: 50,
        }),
      }));
    });
    expect(openedTabs).toEqual(["https://www.zhihu.com/people/example"]);
  });

  it("deletes a corpus box from the detail page through the background API", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "素材箱" }));
    await userEvent.click(screen.getByText("知乎大V素材"));
    await userEvent.click(await screen.findByRole("button", { name: "删除此素材箱" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "corpus:deleteBox",
        payload: { boxId: seededBoxId },
      }));
    });
  });

  it("imports pasted and uploaded corpus entries through the background API", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "素材箱" }));
    await userEvent.click(screen.getByRole("button", { name: "新建素材箱" }));
    await userEvent.click(screen.getByText("自行导入"));
    await userEvent.type(screen.getByPlaceholderText("例如 罗翔的知乎"), "手动导入箱");
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));

    await userEvent.upload(
      await screen.findByLabelText(/导入文件/),
      new File([JSON.stringify({ entries: [{ content: "文件素材", source: "file" }] })], "entries.json", { type: "application/json" }),
    );
    await userEvent.type(screen.getByLabelText(/粘贴文本/), "粘贴第一段\n\n粘贴第二段");
    await userEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "corpus:addEntries",
        payload: expect.objectContaining({
          entries: [
            { source: "file", content: "文件素材", metadata: {} },
            { source: "self-import", content: "粘贴第一段", metadata: {} },
            { source: "self-import", content: "粘贴第二段", metadata: {} },
          ],
        }),
      }));
    });
    expect(await screen.findByText("文件素材")).toBeTruthy();
    expect(screen.getByText("粘贴第一段")).toBeTruthy();
    expect(screen.getByText("粘贴第二段")).toBeTruthy();
  });

  it("creates a draft Skill, runs configured tryout rounds, accepts feedback, and publishes", async () => {
    await seedCreatorModel();
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "这个观点没问题");
    await userEvent.click(screen.getByRole("button", { name: "发送试打" }));
    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "你说得太绝对");
    await userEvent.click(screen.getByRole("button", { name: "发送试打" }));
    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "我觉得可以");
    await userEvent.click(screen.getByRole("button", { name: "发送试打" }));

    expect(await screen.findByText("试打反馈")).toBeTruthy();
    await userEvent.click(screen.getByText("不够狠"));
    await userEvent.type(screen.getByPlaceholderText("补充你觉得哪里不像、哪里弱..."), "逻辑再压紧一点");
    await userEvent.click(screen.getByRole("button", { name: "应用反馈" }));
    await userEvent.click(await screen.findByRole("button", { name: "发布 Skill" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "skills:createDraft",
        payload: expect.objectContaining({
          source_box_ids: [seededBoxId],
          skill_name: "Clapback Skill",
          skill_goal: "creator goal",
        }),
      }));
      expect(messages.some((message) => message.type === "skills:publish")).toBe(true);
    });
  });

  it("shows a recoverable feedback limit error after three rebuilds", async () => {
    await seedCreatorModel();
    render(<App />);

    await createDraftFromCreator();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await completeTryoutRounds(cycle);
      await userEvent.type(screen.getByPlaceholderText("补充你觉得哪里不像、哪里弱..."), `第 ${cycle + 1} 次反馈`);
      await userEvent.click(screen.getByRole("button", { name: "应用反馈" }));
      await waitFor(() => {
        expect(messages.filter((message) => message.type === "skills:applyFeedback")).toHaveLength(cycle + 1);
      });
      expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    }

    await completeTryoutRounds(3);
    await userEvent.type(screen.getByPlaceholderText("补充你觉得哪里不像、哪里弱..."), "第 4 次反馈");
    await userEvent.click(screen.getByRole("button", { name: "应用反馈" }));

    expect((await screen.findAllByText("反馈重建最多 3 次")).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "应用反馈" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a recoverable publish validation error when publishing is blocked", async () => {
    await seedCreatorModel();
    render(<App />);
    await createDraftFromCreator();

    const sendMessage = chrome.runtime.sendMessage as unknown as {
      getMockImplementation: () => ((message: CapturedMessage, callback?: (response: unknown) => void) => unknown) | undefined;
      mockImplementation: (fn: (message: CapturedMessage, callback?: (response: unknown) => void) => unknown) => void;
    };
    const originalSendMessage = sendMessage.getMockImplementation();
    sendMessage.mockImplementation((message, callback) => {
      if (message.type === "skills:publish") {
        const response = {
          ok: false,
          error: "skill_creator_publish_blocked:manifest.json missing required fields: id",
        };
        if (callback) {
          callback(response);
          return undefined;
        }
        return Promise.resolve(response);
      }
      return originalSendMessage?.(message, callback);
    });

    await userEvent.click(screen.getByRole("button", { name: "发布 Skill" }));

    expect((await screen.findAllByText(/发布前校验未通过/)).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "发布 Skill" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows Skill Creator creation stages while the draft request is still running", async () => {
    const model = await seedCreatorModel({ deferDraft: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect(await screen.findByText("校验素材")).toBeTruthy();
    expect(screen.getByText("读取素材")).toBeTruthy();
    expect(screen.getByText("生成草稿")).toBeTruthy();
    expect(screen.getByText("编译检查")).toBeTruthy();
    expect(screen.getByText("进入试打")).toBeTruthy();
    await waitFor(() => {
      expect(activeCreationStage()).toContain("生成草稿");
    });
    expect(completedCreationStages()).toEqual(["校验素材", "读取素材"]);

    model.resolveDraft();
    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    await waitFor(() => {
      expect(activeCreationStage()).toContain("进入试打");
    });
  });

  it("shows a recoverable creation failure reason when Skill Creator lacks a model", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect((await screen.findAllByText("缺少模型配置或 API Key")).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "创建技能" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a recoverable provider failure reason while creating a Skill", async () => {
    await seedCreatorModel({ failDraftStatus: 401 });
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect((await screen.findAllByText("模型请求被拒绝，请检查 API Key 或权限")).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "创建技能" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a recoverable material-insufficient error while creating a Skill", async () => {
    await seedCreatorModel();
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.click(await screen.findByRole("tab", { name: "素材箱" }));
    await userEvent.click(screen.getByRole("button", { name: "新建素材箱" }));
    await userEvent.click(screen.getByText("自行导入"));
    await userEvent.type(screen.getByPlaceholderText("例如 罗翔的知乎"), "不足素材箱");
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await userEvent.type(screen.getByLabelText(/粘贴文本/), "只有一条短素材");
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));

    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("不足素材箱"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect((await screen.findAllByText("素材不足，请先补充更多有效样本")).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "创建技能" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a recoverable invalid Skill output error while creating a Skill", async () => {
    await seedCreatorModel({ invalidDraftOutput: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect((await screen.findAllByText("模型返回的 Skill 无效，请重试")).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "创建技能" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a pending assistant bubble immediately after sending a tryout", async () => {
    const model = await seedCreatorModel({ deferTryout: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "这个观点没问题");
    await userEvent.click(screen.getByRole("button", { name: "发送试打" }));

    expect(await screen.findByText("这个观点没问题")).toBeTruthy();
    expect(await screen.findByText("正在试打...")).toBeTruthy();

    model.resolveTryout();
    expect(await screen.findByText("先把证据摆出来。")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("正在试打...")).toBeNull();
    });
  });

  it("guards against duplicate tryout sends before the pending state commits", async () => {
    const model = await seedCreatorModel({ deferTryout: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "这个观点没问题");
    const input = screen.getByPlaceholderText("输入任意言论...");
    const button = screen.getByRole("button", { name: "发送试打" });

    act(() => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      fireEvent.click(button);
    });

    expect(await screen.findByText("正在试打...")).toBeTruthy();
    expect(messages.filter((message) => message.type === "skills:runTryout")).toHaveLength(1);

    model.resolveTryout();
  });

  it("shows the degraded tryout reason when model fallback is used", async () => {
    await seedCreatorModel();
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    const fetchMock = fetch as unknown as { mockResolvedValueOnce: (value: unknown) => void };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API key" } }),
    });

    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "这个观点没问题");
    await userEvent.click(screen.getByRole("button", { name: "发送试打" }));

    expect(await screen.findByText("已降级：模型请求被拒绝，请检查 API Key 或权限")).toBeTruthy();
  });

  it("keeps a recoverable failed tryout bubble when the tryout request fails", async () => {
    await seedCreatorModel();
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    const sendMessage = chrome.runtime.sendMessage as unknown as {
      getMockImplementation: () => ((message: CapturedMessage, callback?: (response: unknown) => void) => unknown) | undefined;
      mockImplementation: (fn: (message: CapturedMessage, callback?: (response: unknown) => void) => unknown) => void;
    };
    const originalSendMessage = sendMessage.getMockImplementation();
    sendMessage.mockImplementation((message, callback) => {
      if (message.type === "skills:runTryout") {
        messages.push({ type: message.type, payload: message.payload });
        const response = { ok: false, error: "skill_creator_model_required" };
        if (callback) {
          callback(response);
          return undefined;
        }
        return Promise.resolve(response);
      }
      return originalSendMessage?.(message, callback);
    });

    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "这个观点没问题");
    await userEvent.click(screen.getByRole("button", { name: "发送试打" }));

    expect((await screen.findAllByText("缺少模型配置或 API Key")).length).toBeGreaterThan(0);
    expect(screen.getByText("这个观点没问题")).toBeTruthy();
    expect((screen.getByRole("button", { name: "发送试打" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("正在试打...")).toBeNull();
  });

  it("sends custom target length settings with Skill tryout requests", async () => {
    await seedCreatorModel();
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), "creator goal");
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));

    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
    expect(screen.queryByLabelText("试打长度")).toBeNull();
    await userEvent.clear(screen.getByLabelText("目标字数"));
    await userEvent.type(screen.getByLabelText("目标字数"), "18");
    await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), "这个观点没问题");
    await userEvent.click(screen.getByRole("button", { name: "发送试打" }));

    await waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({
        type: "skills:runTryout",
        payload: expect.objectContaining({
          lengthMode: "自定义",
          customLengthTarget: 18,
        }),
      }));
    });
  });

  it("shows only skill name and creation goal in the Skill Library list, with scoring details on the detail page", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("tab", { name: "技能库" }));

    expect(await screen.findByText("Draft Skill")).toBeTruthy();
    expect(screen.getByText("creator goal")).toBeTruthy();
    expect(screen.queryByText("64")).toBeNull();
    expect(screen.queryByText("low")).toBeNull();
    expect(screen.queryByText("编译通过")).toBeNull();

    await userEvent.click(screen.getByText("Draft Skill"));

    expect(await screen.findByText("评分与风险")).toBeTruthy();
    const riskSection = document.querySelector(".skill-detail__risk");
    expect(riskSection?.textContent).toContain("50");
    expect(riskSection?.textContent).toContain("low");
    expect(riskSection?.textContent).toContain("暂无风险提示");
    expect(screen.getByText("style_profile.json")).toBeTruthy();
    expect(screen.getByText("attack_playbook.json")).toBeTruthy();
  });

  async function createDraftFromCreator(goal = "creator goal"): Promise<void> {
    await userEvent.click(await screen.findByRole("tab", { name: "技能工坊" }));
    await userEvent.type(screen.getByLabelText("创建目标"), goal);
    await userEvent.click(await screen.findByLabelText("知乎大V素材"));
    await userEvent.click(screen.getByRole("button", { name: "创建技能" }));
    expect(await screen.findByText("输入任意言论，当前 Skill 会直接进行反驳试打。")).toBeTruthy();
  }

  async function completeTryoutRounds(cycle: number): Promise<void> {
    const before = messages.filter((message) => message.type === "skills:runTryout").length;
    for (let round = 0; round < 3; round += 1) {
      await userEvent.type(screen.getByPlaceholderText("输入任意言论..."), `第 ${cycle + 1} 轮 ${round + 1}`);
      await userEvent.click(screen.getByRole("button", { name: "发送试打" }));
    }
    await waitFor(() => {
      expect(messages.filter((message) => message.type === "skills:runTryout")).toHaveLength(before + 3);
    });
    expect(await screen.findByText("试打反馈")).toBeTruthy();
  }

  function activeCreationStage(): string {
    return document.querySelector(".creator-stage-list__item--active")?.textContent ?? "";
  }

  function completedCreationStages(): string[] {
    return [...document.querySelectorAll(".creator-stage-list__item--done")]
      .map((item) => item.textContent ?? "");
  }
});

type SeedCreatorModelOptions = {
  deferDraft?: boolean;
  deferTryout?: boolean;
  failDraftStatus?: number;
  invalidDraftOutput?: boolean;
};

type SeedCreatorModelControls = {
  resolveDraft: () => void;
  resolveTryout: () => void;
};

async function seedCreatorModel(options: SeedCreatorModelOptions = {}): Promise<SeedCreatorModelControls> {
  let resolveDraft: (() => void) | undefined;
  let resolveTryout: (() => void) | undefined;
  const draftGate = options.deferDraft ? new Promise<void>((resolve) => { resolveDraft = resolve; }) : undefined;
  const tryoutGate = options.deferTryout ? new Promise<void>((resolve) => { resolveTryout = resolve; }) : undefined;

  await handleExtensionMessage({
    type: "models:save",
    payload: {
      provider: "OpenAI",
      model_name: "gpt-test",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-workbench-creator",
      is_default: true,
    },
  });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const isDraftRequest = body.includes("Skill 设计器");
    if (isDraftRequest && draftGate) await draftGate;
    if (isDraftRequest && options.failDraftStatus) {
      return {
        ok: false,
        status: options.failDraftStatus,
        json: async () => ({ error: { message: "Invalid API key" } }),
      };
    }
    if (!isDraftRequest && tryoutGate) await tryoutGate;
    const draftContent = options.invalidDraftOutput
      ? "not-json"
      : JSON.stringify({
        skill_md: "# Workbench Skill\n\n追问证据，压住跳步结论。",
        style_profile: { tone: "短促" },
        attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
        sample_outputs: [
          { prompt: "你不懂", reply: "先把证据摆出来。" },
          { prompt: "大家都这么说", reply: "共识不是证据。" },
        ],
      });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: isDraftRequest ? draftContent : "先把证据摆出来。",
          },
        }],
      }),
    };
  }));
  return {
    resolveDraft: () => resolveDraft?.(),
    resolveTryout: () => resolveTryout?.(),
  };
}

function fixedAttackPlaybook(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...extra,
    taxonomy: {
      classification: 0.25,
      rhetorical_question: 0.2,
      analogy: 0.1,
      counterfactual: 0.05,
      reduction: 0.1,
      irony: 0.05,
      definition_war: 0.1,
      compressed_conclusion: 0.15,
    },
  };
}
