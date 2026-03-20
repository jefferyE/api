import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// 环境变量
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || '';
const SEEDREAM_API_BASE_URL = process.env.SEEDREAM_API_BASE_URL || '';
const SEEDREAM_API_KEY = process.env.SEEDREAM_API_KEY || '';

// OpenAI 实例
const client = new OpenAI({
  baseURL: SEEDREAM_API_BASE_URL,
  apiKey: SEEDREAM_API_KEY,
});

// 统一响应处理
const createResponse = (statusCode, data) => {
  return NextResponse.json(data, {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
    },
  });
};

// 处理 POST 请求
export async function POST(request) {
  try {
    // 鉴权验证
    const clientToken = request.headers.get('x-auth-token') || request.headers.get('X-Auth-Token');
    if (!API_AUTH_TOKEN || clientToken !== API_AUTH_TOKEN) {
      return createResponse(401, { code: 401, message: '鉴权失败' });
    }

    // 解析请求体
    // const body = await request.json().catch(() => ({}));
    // 解析请求体（先提取image字段，再解析剩余JSON）
    let body = {};
    let imageValue = [];
    try {
      const text = await request.text();

      // 先提取image字段的值（支持字符串或数组格式）
      const imageMatch = text.match(/"image"\s*:\s*(?:"([^"]*)"|(\[[\s\S]*?\]))/);
      if (imageMatch) {
        try {
          imageValue = imageMatch[2] ? JSON.parse(imageMatch[2]) : imageMatch[1];
        } catch {
          imageValue = imageMatch[1] || [];
        }
      }

      // 移除image字段后再解析JSON
      const withoutImage = text.replace(/,"image"\s*:\s*(?:"[^"]*"|\[[\s\S]*?\])/g, '').replace(/"image"\s*:\s*(?:"[^"]*"|\[[\s\S]*?\]),?/g, '');
      const cleaned = withoutImage
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/\n/g, '')
        .replace(/\r/g, '')
        .trim();

      body = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse error:', e.message);
      body = {};
    }
    const { prompt = '', size = '2K' } = body;

    if (!prompt) {
      return createResponse(400, { code: 400, error: 'prompt 不能为空' });
    }

    // 调用生图 API
    const response = await client.images.generate({
      model: 'doubao-seedream-4-5-251128',
      prompt: prompt,
      image: image,
      watermark: false,
      size: size,
      response_format: 'b64_json',
      sequential_image_generation: 'disabled',
    });

    return createResponse(200, {
      code: 200,
      data: response.data[0]?.b64_json,
      message: '调用成功',
    });
  } catch (error) {
    console.error('图片生成错误:', error);
    return createResponse(500, {
      code: 500,
      message: error.message || '图片生成失败',
    });
  }
}

// 处理 OPTIONS 预检请求
export async function OPTIONS() {
  return createResponse(200, { message: 'OK' });
}