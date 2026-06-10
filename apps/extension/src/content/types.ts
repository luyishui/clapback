export type ClapbackSettings = {
  activeSkillId: string;
  lengthMode: string;
  customLengthTarget?: number;
  ammoBoxIds?: number[];
};

export type ClapbackTarget = {
  id: string;
  text: string;
};

export type ClapbackContext = {
  pageTitle: string;
  sourceTitle?: string;
  sourceText?: string;
  nearbyComments: string[];
};

export type SkillOption = {
  id: string;
  name?: string;
};

export type AmmoBoxOption = {
  id: number;
  name: string;
};

export type ClapbackPlatform = "zhihu" | "weibo" | "xiaohongshu" | "unknown";

export type GenerateRequest = {
  platform: ClapbackPlatform;
  target: ClapbackTarget;
  context: ClapbackContext;
  intent: string;
  settings: ClapbackSettings;
};

export type GenerateResponse = {
  candidates: string[];
};

export type RuntimeClient = {
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  listSkills?(): Promise<SkillOption[]>;
  listAmmoBoxes?(): Promise<AmmoBoxOption[]>;
};
