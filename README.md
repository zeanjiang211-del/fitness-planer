# 专属训练与饮食规划

这是一个可部署分享的中文网页端产品，包含：

- 训练和饮食计划生成
- 每日热量、蛋白质、脂肪、碳水估算
- 具体食物克重建议
- 围度体脂测算
- 照片预览和视觉特征体脂估算
- 可选 AI 照片体脂估算接口

## 本地运行

需要 Node.js 18 或以上。

```powershell
npm start
```

打开：

```text
http://localhost:3000
```

## 部署分享

推荐部署到 Render、Railway 或其他支持 Node.js 的平台。

启动命令：

```text
node server.js
```

Render 可直接识别 `render.yaml`。

## 可选 AI 照片估算

默认情况下，照片不会上传，只在浏览器本地预览；体脂估算使用用户选择的视觉特征。

如需启用 AI 照片估算，需要在部署平台配置：

```text
OPENAI_API_KEY=你的 API Key
OPENAI_MODEL=支持图片输入的模型名
```

未配置时，`/api/body-fat/photo-ai` 会返回不可用提示，前端仍可使用围度法和视觉特征估算。

## API

- `GET /api/health`
- `POST /api/plan`
- `POST /api/body-fat/measurements`
- `POST /api/body-fat/visual-estimate`
- `POST /api/body-fat/photo-ai`

## 重要说明

本工具只用于健康管理参考，不替代医生、营养师或专业教练建议。围度法和照片估算都存在误差，建议结合长期趋势判断。
