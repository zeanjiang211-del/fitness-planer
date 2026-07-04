const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const goalLabels = {
  fat_loss: "减脂",
  muscle_gain: "增肌",
  recomposition: "塑形",
  maintenance: "维持"
};

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 8 * 1024 * 1024) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeProfile(input) {
  return {
    weightKg: Number(input.weightKg),
    bodyFatPercent: Number(input.bodyFatPercent),
    heightCm: Number(input.heightCm),
    age: Number(input.age),
    sex: input.sex,
    activityLevel: input.activityLevel,
    goal: input.goal,
    trainingDaysPerWeek: Number(input.trainingDaysPerWeek)
  };
}

function validateProfile(profile) {
  const errors = [];
  if (profile.weightKg < 35 || profile.weightKg > 220) errors.push("体重请输入 35 到 220 公斤之间的数值。");
  if (profile.bodyFatPercent < 5 || profile.bodyFatPercent > 60) errors.push("体脂率请输入 5% 到 60% 之间的数值。");
  if (profile.heightCm < 120 || profile.heightCm > 230) errors.push("身高请输入 120 到 230 厘米之间的数值。");
  if (profile.age < 16 || profile.age > 80) errors.push("年龄请输入 16 到 80 岁之间的数值。");
  if (profile.trainingDaysPerWeek < 2 || profile.trainingDaysPerWeek > 6) errors.push("每周训练天数请输入 2 到 6 天。");
  if (!["male", "female"].includes(profile.sex)) errors.push("请选择有效性别。");
  if (!["sedentary", "light", "moderate", "high"].includes(profile.activityLevel)) errors.push("请选择有效活动量。");
  if (!["fat_loss", "muscle_gain", "recomposition", "maintenance"].includes(profile.goal)) errors.push("请选择有效训练目标。");
  return errors;
}

function calculatePlan(profile) {
  const leanMass = profile.weightKg * (1 - profile.bodyFatPercent / 100);
  const bmrByKatch = 370 + 21.6 * leanMass;
  const sexOffset = profile.sex === "male" ? 5 : -161;
  const bmrByMifflin = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + sexOffset;
  const bmr = (bmrByKatch + bmrByMifflin) / 2;
  const activityFactor = { sedentary: 1.2, light: 1.38, moderate: 1.55, high: 1.72 }[profile.activityLevel];
  const goalFactor = { fat_loss: 0.82, muscle_gain: 1.1, recomposition: 0.95, maintenance: 1 }[profile.goal];
  const dailyCalories = roundTo(bmr * activityFactor * goalFactor, 25);
  const proteinMultiplier = { fat_loss: 2, muscle_gain: 1.8, recomposition: 2, maintenance: 1.6 }[profile.goal];
  const proteinG = Math.round(profile.weightKg * proteinMultiplier);
  const fatG = Math.round(clamp((dailyCalories * 0.25) / 9, profile.weightKg * 0.7, profile.weightKg * 1.1));
  const carbsG = Math.max(50, Math.round((dailyCalories - proteinG * 4 - fatG * 9) / 4));
  const macros = { proteinG, fatG, carbsG };

  return {
    dailyCalories,
    macros,
    weeklyTrainingPlan: buildTrainingWeek(profile, { dailyCalories, ...macros }),
    notes: [
      `本计划按${goalLabels[profile.goal]}目标生成，估算每日摄入约 ${dailyCalories} 千卡。`,
      "食物克重按生重或包装标注重量估算，烹饪用油、酱料和饮料需要额外记录。",
      "每次力量训练前热身 8 到 10 分钟，训练后做轻度拉伸。",
      "本工具仅用于健康管理参考，不能替代医生、营养师或专业教练建议。"
    ],
    createdAt: new Date().toISOString(),
    editedAt: new Date().toISOString()
  };
}

function mealPlan(goal, macros) {
  const rice = roundTo(macros.carbsG * 1.15, 10);
  const proteinFood = roundTo(macros.proteinG * 1.1, 10);
  const oil = Math.max(10, roundTo(macros.fatG * 0.45, 5));
  const fruit = goal === "fat_loss" ? 150 : 250;
  const dairy = goal === "muscle_gain" ? 300 : 200;
  const oats = goal === "muscle_gain" ? 70 : 50;
  if (goal === "fat_loss") {
    return [
      `早餐：燕麦 ${oats} 克、鸡蛋 2 个、无糖酸奶 ${dairy} 克`,
      `午餐：米饭 ${roundTo(rice * 0.55, 10)} 克、鸡胸/鱼虾 ${roundTo(proteinFood * 0.45, 10)} 克、蔬菜 250 克、烹饪油 ${roundTo(oil * 0.45, 5)} 克`,
      `加餐：水果 ${fruit} 克、低脂奶或豆浆 250 毫升`,
      `晚餐：红薯或米饭 ${roundTo(rice * 0.35, 10)} 克、瘦肉/豆腐 ${roundTo(proteinFood * 0.4, 10)} 克、蔬菜 250 克、烹饪油 ${roundTo(oil * 0.35, 5)} 克`
    ];
  }
  if (goal === "muscle_gain") {
    return [
      `早餐：燕麦 ${oats} 克、鸡蛋 2 个、牛奶或豆浆 ${dairy} 毫升`,
      `午餐：米饭 ${roundTo(rice * 0.6, 10)} 克、鸡胸/牛肉 ${roundTo(proteinFood * 0.45, 10)} 克、蔬菜 250 克、烹饪油 ${roundTo(oil * 0.45, 5)} 克`,
      `加餐：香蕉 1 根、酸奶 ${dairy} 克、坚果 15 克`,
      `晚餐：土豆或面食 ${roundTo(rice * 0.45, 10)} 克、鱼肉/瘦肉 ${roundTo(proteinFood * 0.4, 10)} 克、蔬菜 250 克`
    ];
  }
  return [
    `早餐：燕麦 ${oats} 克、鸡蛋 1 到 2 个、牛奶或豆浆 ${dairy} 毫升`,
    `午餐：米饭 ${roundTo(rice * 0.55, 10)} 克、鸡胸/鱼/豆腐 ${roundTo(proteinFood * 0.45, 10)} 克、蔬菜 250 克`,
    `加餐：水果 ${fruit} 克、酸奶 150 到 200 克`,
    `晚餐：主食 ${roundTo(rice * 0.35, 10)} 克、瘦肉或豆制品 ${roundTo(proteinFood * 0.35, 10)} 克、蔬菜 250 克、烹饪油 ${roundTo(oil * 0.35, 5)} 克`
  ];
}

function strengthTemplates(goal) {
  const repText = goal === "muscle_gain" ? "8 到 12 次" : "10 到 15 次";
  return [
    { title: "上肢力量", focus: "胸、背、肩和手臂，控制动作质量。", exercises: [`俯卧撑或卧推 4 组，每组 ${repText}`, `坐姿划船或哑铃划船 4 组，每组 ${repText}`, "肩推 3 组", "下拉或引体辅助 3 组"] },
    { title: "下肢力量", focus: "臀腿主导，建立基础力量和稳定性。", exercises: [`深蹲或腿举 4 组，每组 ${repText}`, `罗马尼亚硬拉 4 组，每组 ${repText}`, "箭步蹲 3 组", "臀桥 3 组"] },
    { title: "全身训练", focus: "复合动作组合，兼顾力量和心肺。", exercises: [`硬拉变式 3 组，每组 ${repText}`, "哑铃推举 3 组", "高位下拉 3 组", "卷腹或反向卷腹 3 组"] },
    { title: "弱项强化", focus: "补齐肩背、臀腿和核心稳定。", exercises: ["面拉 3 组", "保加利亚分腿蹲 3 组", "侧平举 3 组", "侧桥 3 组"] }
  ];
}

function buildTrainingWeek(profile, macros) {
  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const kinds = Array(7).fill("rest");
  const order = [0, 1, 3, 4, 5, 2];
  const strengthCount = clamp(profile.trainingDaysPerWeek, 2, 6);
  const cardioCount = profile.goal === "muscle_gain" ? 1 : 2;
  order.slice(0, strengthCount).forEach((index) => { kinds[index] = "strength"; });
  for (let index = 0; index < 7 && kinds.filter((kind) => kind === "cardio").length < cardioCount; index += 1) {
    if (kinds[index] === "rest") kinds[index] = "cardio";
  }
  const templates = strengthTemplates(profile.goal);
  const meals = mealPlan(profile.goal, macros);
  let strengthIndex = 0;
  return kinds.map((kind, index) => {
    if (kind === "strength") {
      const template = templates[strengthIndex % templates.length];
      strengthIndex += 1;
      return { day: dayNames[index], kind, ...template, meals };
    }
    if (kind === "cardio") {
      return { day: dayNames[index], kind, title: "低强度有氧与核心", focus: "保持能说短句的强度，提升消耗和恢复能力。", exercises: ["快走或骑行 30 到 45 分钟", "平板支撑 3 组", "死虫 3 组", "髋部灵活性练习 8 分钟"], meals };
    }
    return { day: dayNames[index], kind, title: "恢复日", focus: "让身体恢复，维持轻活动，保证睡眠。", exercises: ["轻松散步 20 到 30 分钟", "肩颈和髋部拉伸 10 分钟", "记录体感、睡眠和饥饿程度"], meals };
  });
}

function estimateByMeasurements(input) {
  const sex = input.sex;
  const heightCm = Number(input.heightCm);
  const neckCm = Number(input.neckCm);
  const waistCm = Number(input.waistCm);
  const hipCm = Number(input.hipCm || 0);
  const weightKg = Number(input.weightKg || 0);
  const age = Number(input.age || 0);
  const errors = [];
  if (!["male", "female"].includes(sex)) errors.push("请选择有效性别。");
  if (heightCm < 120 || heightCm > 230) errors.push("身高请输入 120 到 230 厘米。");
  if (neckCm < 20 || neckCm > 60) errors.push("颈围请输入 20 到 60 厘米。");
  if (waistCm < 45 || waistCm > 180) errors.push("腰围请输入 45 到 180 厘米。");
  if (sex === "female" && (hipCm < 60 || hipCm > 180)) errors.push("女性臀围请输入 60 到 180 厘米。");
  if (errors.length) return { errors };

  const heightIn = heightCm / 2.54;
  const neckIn = neckCm / 2.54;
  const waistIn = waistCm / 2.54;
  const hipIn = hipCm / 2.54;
  const navy = sex === "male"
    ? 495 / (1.0324 - 0.19077 * Math.log10(waistIn - neckIn) + 0.15456 * Math.log10(heightIn)) - 450
    : 495 / (1.29579 - 0.35004 * Math.log10(waistIn + hipIn - neckIn) + 0.221 * Math.log10(heightIn)) - 450;
  const estimates = [{ method: "美国海军围度法", bodyFatPercent: roundTo(clamp(navy, 5, 60), 0.5), confidence: "中" }];
  if (weightKg >= 35 && age >= 16) {
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    const sexFlag = sex === "female" ? 1 : 0;
    const cunBae = -44.988 + 0.503 * age + 10.689 * sexFlag + 3.172 * bmi - 0.026 * bmi * bmi + 0.181 * bmi * sexFlag - 0.02 * bmi * age - 0.005 * bmi * bmi * sexFlag + 0.00021 * bmi * bmi * age;
    estimates.push({ method: "BMI 年龄修正法", bodyFatPercent: roundTo(clamp(cunBae, 5, 60), 0.5), confidence: "低" });
  }
  const weighted = estimates.length === 1
    ? estimates[0].bodyFatPercent
    : estimates[0].bodyFatPercent * 0.75 + estimates[1].bodyFatPercent * 0.25;
  return {
    bodyFatPercent: roundTo(weighted, 0.5),
    estimates,
    notes: ["围度法适合趋势追踪，但会受测量位置、姿势和皮尺松紧影响。", "建议连续 3 天同一时间测量，取平均值。"]
  };
}

function estimateByVisualFeatures(input) {
  const sex = input.sex === "female" ? "female" : "male";
  const abdomen = Number(input.abdomen || 3);
  const waist = Number(input.waist || 3);
  const muscle = Number(input.muscle || 3);
  const distribution = Number(input.distribution || 3);
  const score = clamp(abdomen * 0.35 + waist * 0.25 + muscle * 0.2 + distribution * 0.2, 1, 5);
  const ranges = sex === "male"
    ? [[10, 13], [14, 17], [18, 22], [23, 28], [29, 36]]
    : [[18, 21], [22, 25], [26, 30], [31, 36], [37, 45]];
  const index = clamp(Math.round(score) - 1, 0, 4);
  const range = ranges[index];
  return {
    bodyFatPercent: Math.round((range[0] + range[1]) / 2),
    range,
    confidence: "低",
    notes: ["该结果基于照片自评特征，不是医学测量。", "如果已输入围度，优先使用围度法；照片估算只作为校验参考。"]
  };
}

async function estimatePhotoWithOpenAI(input) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    return { error: "未配置 OPENAI_API_KEY 或 OPENAI_MODEL，当前部署将使用本地视觉特征估算。" };
  }
  if (!input.imageDataUrl || !String(input.imageDataUrl).startsWith("data:image/")) {
    return { error: "请提供图片。" };
  }
  const prompt = "你是健身评估助手。请基于照片粗略估算体脂率范围，只输出 JSON：{bodyFatPercent:number, range:[min,max], confidence:'低'|'中', observations:string[], disclaimer:string}。不要识别身份，不要评价外貌吸引力。";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: input.imageDataUrl }] }],
      text: { format: { type: "json_object" } }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    return { error: `AI 估算失败：${response.status} ${text.slice(0, 300)}` };
  }
  const data = await response.json();
  const outputText = data.output_text || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text).filter(Boolean).join("\n");
  try {
    return JSON.parse(outputText);
  } catch {
    return { error: "AI 返回结果无法解析。", raw: outputText };
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  const pathname = new URL(req.url, "http://localhost").pathname;
  try {
    if (req.method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true });
    if (req.method === "POST" && pathname === "/api/plan") {
      const body = await readBody(req);
      const profile = normalizeProfile(body.profile || body);
      const errors = validateProfile(profile);
      if (errors.length) return sendJson(res, 400, { errors });
      return sendJson(res, 200, calculatePlan(profile));
    }
    if (req.method === "POST" && pathname === "/api/body-fat/measurements") {
      const result = estimateByMeasurements(await readBody(req));
      return sendJson(res, result.errors ? 400 : 200, result);
    }
    if (req.method === "POST" && pathname === "/api/body-fat/visual-estimate") {
      return sendJson(res, 200, estimateByVisualFeatures(await readBody(req)));
    }
    if (req.method === "POST" && pathname === "/api/body-fat/photo-ai") {
      const result = await estimatePhotoWithOpenAI(await readBody(req));
      return sendJson(res, result.error ? 501 : 200, result);
    }
    if (req.method === "GET") return serveStatic(req, res);
    return sendJson(res, 404, { error: "接口不存在" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "服务器错误" });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Fitness planner server running at http://localhost:${PORT}`);
  });
}

module.exports = { calculatePlan, estimateByMeasurements, estimateByVisualFeatures, server };
