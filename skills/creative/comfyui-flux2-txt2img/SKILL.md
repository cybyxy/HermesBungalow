---
name: comfyui-flux2-txt2img
description: Use when asked to generate images via ComfyUI Flux.2-Klein text-to-image on a remote server. Invokes the "Flux.2-Klein-文生图" workflow by sending a text prompt and returning the generated image.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [comfyui, flux, image-generation, text-to-image, mlops]
    related_skills: [design-image-prompt-engineer, audiocraft-audio-generation]
---

# ComfyUI Flux.2-Klein 文生图

## Overview

通过 ComfyUI REST API 调用远程服务器（`192.168.1.3:3000`）上的 **Flux.2-Klein-文生图** 工作流，输入文字提示词生成图片。

## When to Use

- 用户提供一段文字描述，需要生成对应图片
- 需要调用 Flux.2 模型进行 AI 画图
- 作为设计素材、创意灵感、概念可视化的自动化工具

## 服务器配置

- **地址**: `http://192.168.1.3:3000`
- **API 端点**: ComfyUI 原生 REST API
- **工作流名称**: Flux.2-Klein-文生图

## ComfyUI API 核心知识

ComfyUI 通过 `/prompt` 接口提交任务，通过 `/history/{prompt_id}` 查询结果：

```
POST http://192.168.1.3:3000/prompt
GET  http://192.168.1.3:3000/history/{prompt_id}
GET  http://192.168.1.3:3000/object_info
GET  http://192.168.1.3:3000/system_stats
```

## 调用流程

### Step 1: 查询工作流节点信息

首先需要获取 Flux.2-Klein 工作流的节点 ID 和各节点的输入槽位：

```bash
curl -s http://192.168.1.3:3000/object_info | python3 -c "
import json, sys
data = json.load(sys.stdin)
# 查找 Flux.2-Klein 相关节点（CLIPTextEncode、KSampler、VAEDecode 等）
for k, v in data.items():
    if 'flux' in k.lower() or 'klein' in k.lower():
        print(k)
"
```

### Step 2: 构造 Prompt JSON 并提交

典型 Flux.2-Klein 工作流的节点结构：

```json
{
  "prompt": {
    "node_id_1": {
      "class_type": "CheckpointLoaderSimple",
      "inputs": {
        "ckpt_name": "flux2_klein.safetensors"
      }
    },
    "node_id_2": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": "你的提示词",
        "clip": ["node_id_1", 0]
      }
    },
    "node_id_3": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": "negative prompt（可选，空字符串表示无）",
        "clip": ["node_id_1", 0]
      }
    },
    "node_id_4": {
      "class_type": "DualCLIPLoader",
      "inputs": {
        "clip_name1": "flux2_klein_clip.safetensors",
        "clip_name2": "flux2_klein_t5.safetensors"
      }
    },
    "node_id_5": {
      "class_type": "FluxGuidance",
      "inputs": {
        "guidance": 3.5
      }
    },
    "node_id_6": {
      "class_type": "KSampler", 
      "inputs": {
        "model": ["node_id_1", 0],
        "positive": ["node_id_2", 0],
        "negative": ["node_id_3", 0],
        "seed": 0,
        "steps": 20,
        "cfg": 1.0,
        "sampler_name": "euler",
        "scheduler": "normal"
      }
    },
    "node_id_7": {
      "class_type": "VAEDecode",
      "inputs": {
        "samples": ["node_id_6", 0],
        "vae": ["node_id_1", 1]
      }
    },
    "node_id_8": {
      "class_type": "SaveImage",
      "inputs": {
        "images": ["node_id_7", 0],
        "filename_prefix": "flux2_output"
      }
    }
  }
}
```

### Step 3: 提交任务

```python
import requests
import json
import time

COMFYUI_URL = "http://192.168.1.3:3000"

def submit_prompt(prompt_json):
    response = requests.post(f"{COMFYUI_URL}/prompt", json=prompt_json)
    response.raise_for_status()
    return response.json()  # {"prompt_id": "...", "number": N}

def wait_and_get_history(prompt_id, timeout=120, poll_interval=3):
    """轮询等待图片生成完成"""
    for _ in range(timeout // poll_interval):
        time.sleep(poll_interval)
        resp = requests.get(f"{COMFYUI_URL}/history/{prompt_id}")
        resp.raise_for_status()
        history = resp.json()
        if prompt_id in history and history[prompt_id].get("outputs"):
            return history[prompt_id]
    raise TimeoutError(f"任务 {prompt_id} 超过 {timeout}s 未完成")

def generate_image(prompt_text, negative_text="", seed=0, steps=20):
    # Step 1: 获取工作流模板
    obj_info = requests.get(f"{COMFYUI_URL}/object_info").json()
    
    # Step 2: 构造 prompt（根据实际节点调整，这里给出典型结构）
    prompt_data = {
        "node_id_1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "flux2_klein.safetensors"}
        },
        "node_id_2": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt_text, "clip": ["node_id_1", 0]}
        },
        "node_id_3": {
            "class_type": "CLIPTextEncode", 
            "inputs": {"text": negative_text or "", "clip": ["node_id_1", 0]}
        },
        "node_id_5": {
            "class_type": "FluxGuidance",
            "inputs": {"guidance": 3.5}
        },
        "node_id_6": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["node_id_1", 0],
                "positive": ["node_id_2", 0],
                "negative": ["node_id_3", 0],
                "seed": seed,
                "steps": steps,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "normal"
            }
        },
        "node_id_7": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["node_id_6", 0], "vae": ["node_id_1", 1]}
        },
        "node_id_8": {
            "class_type": "SaveImage",
            "inputs": {"images": ["node_id_7", 0], "filename_prefix": "flux2_output"}
        }
    }
    
    payload = {"prompt": prompt_data}
    result = submit_prompt(payload)
    prompt_id = result["prompt_id"]
    
    history = wait_and_get_history(prompt_id)
    
    # 从 history 中提取图片
    outputs = history["outputs"]
    images = []
    for node_id, output in outputs.items():
        if "images" in output:
            for img in output["images"]:
                images.append({
                    "node_id": node_id,
                    "filename": img["filename"],
                    "subfolder": img.get("subfolder", ""),
                    "type": img.get("type", "output")
                })
    
    return {
        "prompt_id": prompt_id,
        "images": images,
        "history_url": f"{COMFYUI_URL}/history/{prompt_id}"
    }
```

## 常用参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prompt_text` | string | 必填 | 正向提示词，描述你想生成的图片 |
| `negative_text` | string | "" | 负向提示词，描述不想出现的内容 |
| `seed` | int | 0 | 随机种子，0=随机，固定值可复现 |
| `steps` | int | 20 | 采样步数，越高质量越好但更慢 |
| `guidance` | float | 3.5 | Flux 引导强度 |

## 注意事项

1. **节点 ID 需要从实际工作流中确认**：不同 ComfyUI 部署的工作流节点 ID 不同，首次调用前建议先调用 `/object_info` 确认
2. **图片获取**：生成的图片默认保存在 ComfyUI 的 `output` 目录，可通过 `GET /view?filename=xxx&subfolder=xxx&type=output` 访问
3. **超时处理**：Flux.2 生成较慢，建议 timeout 设置不低于 120 秒
4. **服务器可达性**：确保本机/agent 环境能访问 `192.168.1.3:3000`

## 快速验证

检查 ComfyUI 服务是否在线：

```bash
curl -s http://192.168.1.3:3000/system_stats | python3 -c "import json,sys; d=json.load(sys.stdin); print('GPU:', d.get('gpu', d.get('device', 'unknown')))"
```

## 常见错误处理

| 错误 | 原因 | 解决方法 |
|------|------|---------|
| `ConnectionRefusedError` | 服务未启动或 IP 不通 | 检查服务器是否在线，确认端口 3000 可达 |
| `400 Bad Request` | prompt JSON 格式错误 | 检查节点 ID 和输入槽位是否匹配 |
| `404 Not Found` | 模型文件不存在 | 确认 flux2_klein.safetensors 已下载到 ComfyUI 模型目录 |
| `timeout` | 生成时间过长 | 增加 `timeout` 参数值 |

## 完整调用示例

```python
result = generate_image(
    prompt_text="A serene lake at sunset with mountains in the background, photorealistic, 8k",
    negative_text="blurry, low quality, distorted",
    seed=42,
    steps=25
)
print(f"生成完成，图片列表: {result['images']}")
```

