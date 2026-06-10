import { useCallback, useEffect, useState } from "react";
import type {
  AmmoBoxSummary,
  CorpusBox,
  HealthStatus,
  ModelConfig,
  RuntimeSettings,
  SkillInfo,
} from "../runtimeApi";
import { runtimeApi } from "../runtimeApi";

export type RuntimeData = {
  health: HealthStatus | null;
  settings: RuntimeSettings | null;
  models: ModelConfig[];
  boxes: CorpusBox[];
  skills: SkillInfo[];
  ammoBoxes: AmmoBoxSummary[];
  refreshHealth: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshBoxes: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshAmmo: () => Promise<void>;
};

export function useRuntimeData(): RuntimeData {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [boxes, setBoxes] = useState<CorpusBox[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [ammoBoxes, setAmmoBoxes] = useState<AmmoBoxSummary[]>([]);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await runtimeApi.health());
    } catch {
      setHealth({ ok: false, service: "clapback-extension", version: "" });
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try { setSettings(await runtimeApi.getSettings()); } catch { /* offline */ }
  }, []);

  const refreshModels = useCallback(async () => {
    try { setModels(await runtimeApi.listModels()); } catch { setModels([]); }
  }, []);

  const refreshBoxes = useCallback(async () => {
    try { setBoxes(await runtimeApi.listBoxes()); } catch { setBoxes([]); }
  }, []);

  const refreshSkills = useCallback(async () => {
    try { setSkills(await runtimeApi.listSkills()); } catch { setSkills([]); }
  }, []);

  const refreshAmmo = useCallback(async () => {
    try { setAmmoBoxes(await runtimeApi.listAmmoBoxes()); } catch { setAmmoBoxes([]); }
  }, []);

  useEffect(() => {
    refreshHealth();
    refreshSettings();
    refreshModels();
    refreshBoxes();
    refreshSkills();
    refreshAmmo();
  }, [refreshHealth, refreshSettings, refreshModels, refreshBoxes, refreshSkills, refreshAmmo]);

  return {
    health, settings, models, boxes, skills, ammoBoxes,
    refreshHealth, refreshSettings, refreshModels, refreshBoxes, refreshSkills, refreshAmmo,
  };
}
