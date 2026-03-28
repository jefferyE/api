import { NextResponse } from 'next/server';
import OpenAI from 'openai';
// import https from 'https';

// 全局加速 HTTPS 请求（关键！）
// const httpsAgent = new https.Agent({
//   keepAlive: true,
//   rejectUnauthorized: false
// });

// 环境变量
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || 'xsd1dfd8caa-d7fc-4c7d-b4a1-5bf3c21bf168';
const SEEDREAM_API_BASE_URL = process.env.SEEDREAM_API_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const SEEDREAM_API_KEY = process.env.SEEDREAM_API_KEY || '1dfd8caa-d7fc-4c7d-b4a1-5bf3c21bf168';

// OpenAI 实例
const client = new OpenAI({
  baseURL: SEEDREAM_API_BASE_URL,
  apiKey: SEEDREAM_API_KEY,
  // httpAgent: httpsAgent, // 关键：给 SDK 传入 agent
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

// File 转 base64
const fileToBase64 = async (file) => {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const base64 = buffer.toString('base64');
  // 根据 mimeType 添加前缀
  const mimeType = file.type || 'image/png';
  return `data:${mimeType};base64,${base64}`;
};

// 处理 POST 请求
export async function POST(request) {
  console.log('[generate] Request:', request);
  try {
    // 鉴权验证
    const clientToken = request.headers.get('x-auth-token') || request.headers.get('X-Auth-Token');
    if (!API_AUTH_TOKEN || clientToken !== API_AUTH_TOKEN) {
      return createResponse(401, { code: 401, message: '鉴权失败' });
    }
    console.log('Received POST /generate');

    // 解析 FormData 请求体
    const formData = await request.formData();
    console.log('[generate] FormData:', formData);

    const prompt = formData.get('prompt') || '';
    const image = formData.getAll('image');
    const size = formData.get('size') || '2K';

    console.log('[generate] Params:', {
      prompt: prompt,
      image: image,
      imageLength: image?.length,
      size,
    });

    if (!prompt) {
      return createResponse(400, { code: 400, error: 'prompt 不能为空' });
    }

    // File 对象数组转 base64 数组
    const _image = await Promise.all(
      image.map(file => fileToBase64(file))
    );

    console.log('[generate] _image:', _image);

    // 调用生图 API
    const response = await client.images.generate({
      model: 'doubao-seedream-4-5-251128',
      // model: 'seedream-5-0-260128',
      prompt: prompt,
      image: _image,
      watermark: false,
      size: '2K',
      response_format: 'b64_json',
      sequential_image_generation: 'disabled',
    });

    console.log('[call] Success, Response data:', response.data);

    return createResponse(200, {
      code: 200,
      data: response.data[0]?.b64_json,
      message: '调用成功',
    });
  } catch (error) {
    console.log('图片生成错误:', error);
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