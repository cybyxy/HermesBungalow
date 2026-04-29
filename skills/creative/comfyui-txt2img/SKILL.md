---
name: comfyui-txt2img
description: Use when asked to generate images via ComfyUI text-to-image workflow on a remote server. Calls the Flux.2-Klein or any txt2img workflow at 192.168.1.3:3000 using ComfyUI REST API.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [comfyui, flux, image-generation, text-to-image, txt2img, mlops]
    related_skills: [design-image-prompt-engineer, audiocraft-audio-generation]
---

# ComfyUI 文本生成图片

## Overview

通过 ComfyUI REST API 调用远程服务器（`http://192.168.1.3:3000`）上的 Flux.2-Klein 文生图工作流，输入文字提示词生成图片。完整实现：提交 prompt → 轮询等待 → 获取图片路径。

## When to Use

- 用户提供文字描述，需要生成对应图片
- 调用 Flux.2 / Klein / SD 等 ComfyUI 工作流进行 AI 画图
- 作为设计素材、创意灵感、概念可视化的自动化工具

## 服务器配置

- **地址**: `http://192.168.1.3:3000`
- **API Base**: 所有接口均以 `/prompt`、`/history/`、`/view` 为路径

## ComfyUI API 速查

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/prompt` | 提交生成任务，返回 `prompt_id` |
| `GET` | `/history/{prompt_id}` | 查询任务状态与输出 |
| `GET` | `/object_info` | 列出所有节点类型（需先调用确认节点 ID） |
| `GET` | `/system_stats` | 检查服务是否在线 |
| `GET` | `/view` | 获取生成的图片文件 |

## 完整实现代码

```python
import requests
import json
import time

COMFYUI_URL = "http://192.168.1.3:3000"


def submit_prompt(prompt_json):
    """提交 prompt 到 ComfyUI，返回 prompt_id"""
    resp = requests.post(f"{COMFYUI_URL}/prompt", json=prompt_json, timeout=30)
    resp.raise_for_status()
    return resp.json()["prompt_id"]


def poll_history(prompt_id, timeout=180, interval=3):
    """轮询 /history/{prompt_id} 直到任务完成或超时"""
    elapsed = 0
    while elapsed < timeout:
        time.sleep(interval)
        elapsed += interval
        resp = requests.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if prompt_id in data and data[prompt_id].get("outputs"):
            return data[prompt_id]
    raise TimeoutError(f"任务 {prompt_id} 超过 {timeout}s 未完成")


def extract_images(outputs):
    """从 history outputs 中提取图片列表"""
    images = []
    for node_id, output in outputs.items():
        if "images" in output:
            for img in output["images"]:
                images.append({
                    "node_id": node_id,
                    "filename": img["filename"],
                    "subfolder": img.get("subfolder", ""),
                    "type": img.get("type", "output"),
                    "url": (f"{COMFYUI_URL}/view?filename={img['filename']}"
                            f"&subfolder={img.get('subfolder','')}&type={img.get('type','output')}")
                })
    return images


def generate_image(prompt_text, negative_text="", seed=0, steps=20,
                   width=720, height=1280, batch_size=1):
    """
    文本生成图片主函数

    参数:
        prompt_text   (str): 正向提示词
        negative_text (str): 负向提示词，默认空
        seed          (int): 随机种子，0=随机，固定值可复现
        steps         (int): 采样步数，默认 20
        width         (int): 图片宽度，默认 720
        height        (int): 图片高度，默认 1280
        batch_size    (int): 批量大小，默认 1

    返回:
        dict: {"prompt_id", "images": [ {...}, ... ], "history_url"}
    """
    # --- Flux.2-Klein 实际节点 ID（来自 API Export） ---
    # 节点关系：85→EmptyLatent → 98(KSampler) → 84(VAEDecode) → 105(SaveImage)
    #           91→CLIPLoader → 93(正向) / 86(负向) → 98
    #           111→UnetLoader → 98
    #           92→VAELoader → 84
    prompt_data = {
        "85": {
            "class_type": "EmptyFlux2LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": batch_size}
        },
        "86": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative_text or "", "clip": ["91", 0]}
        },
        "91": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": "Flux.2-Klein\\qwen_3_8b_fp8mixed.safetensors", "type": "flux2", "device": "default"}
        },
        "92": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "Flux\\flux2-vae.safetensors"}
        },
        "93": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt_text, "clip": ["91", 0]}
        },
        "98": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["111", 0],
                "positive": ["93", 0],
                "negative": ["86", 0],
                "latent_image": ["85", 0]
            }
        },
        "105": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "flux2_txt2img", "images": [["84", 0]]}
        },
        "111": {
            "class_type": "UnetLoaderGGUF",
            "inputs": {"unet_name": "Flux\\Flux.2-Klein\\flux-2-klein-9b-Q6_K.gguf"}
        },
        "84": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["98", 0], "vae": ["92", 0]}
        }
    }

    payload = {"prompt": prompt_data}
    prompt_id = submit_prompt(payload)
    history = poll_history(prompt_id)
    images = extract_images(history["outputs"])

    return {
        "prompt_id": prompt_id,
        "images": images,
        "history_url": f"{COMFYUI_URL}/history/{prompt_id}"
    }
```

## 快速验证（检查服务是否在线）

```bash
curl -s --max-time 5 http://192.168.1.3:3000/system_stats
```

若返回 JSON 则服务在线，若超时或拒绝连接则检查服务器网络。

## 获取实际工作流节点 ID

```bash
curl -s http://192.168.1.3:3000/object_info | python3 -c "import json,sys;d=json.load(sys.stdin);[print(k) for k in d]"
```

拿到节点类型列表后，还需要从 ComfyUI 界面导出实际工作流的 JSON（点击工作流右上角 "Export API"），从中提取真实的节点 ID 替换上方代码中的 `3/4/5/6/7/8/9`。

## 常用参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt_text` | string | 必填 | 正向提示词，描述你想生成的图片 |
| `negative_text` | string | `""` | 负向提示词，描述不想出现的内容 |
| `seed` | int | `0` | 随机种子，0=随机，固定值可复现图片 |
| `steps` | int | `20` | 采样步数，越高质量越好但更慢 |
| `width` | int | `720` | 图片宽度，像素 |
| `height` | int | `1280` | 图片高度，像素 |
| `batch_size` | int | `1` | 每批生成图片数量 |

## 调用示例

```python
result = generate_image(
    prompt_text="A majestic wolf standing on a cliff at golden hour, cinematic lighting, ultra detailed, 8k",
    negative_text="blurry, low quality, distorted, watermark",
    seed=12345,
    steps=25,
    width=720,
    height=1280
)
for img in result["images"]:
    print(img["url"])
```

## 注意事项

1. **节点 ID 必须匹配**：不同 ComfyUI 部署的工作流节点 ID 不同，必须用实际工作流的 API JSON 替换上方 `prompt_data` 中的节点 ID
2. **模型文件存在**：确认 `flux2_klein.safetensors` 已下载到 ComfyUI 的 `models/checkpoints/` 目录
3. **网络可达**：确保调用方能访问 `192.168.1.3:3000`
4. **超时设置**：Flux.2 生成较慢，默认 timeout=180s，若不足请调大

## 常见错误

| 错误信息 | 原因 | 解决方法 |
|----------|------|----------|
| `ConnectionRefusedError` | 服务未启动或 IP 不通 | 检查服务器是否开机，端口 3000 是否开放 |
| `400 Bad Request` | prompt JSON 节点 ID 或输入槽位不匹配 | 导出实际工作流 API JSON 确认节点 ID |
| `404 Not Found` | 模型文件不存在 | 确认 safetensors 文件在正确目录 |
| `TimeoutError` | 生成时间超过 timeout | 增加 `timeout` 参数值 |
