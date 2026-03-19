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

    // 解析 FormData 请求体
    const formData = await request.formData();

    const prompt = formData.get('prompt') || '';
    const imageFiles = formData.getAll('image');
    const size = formData.get('size') || '2K';

    console.log('[generate] Params:', { 
      prompt: prompt?.slice(0, 50) + (prompt?.length > 50 ? '...' : ''), 
      size,
      imageFilesCount: imageFiles?.length 
    });

    // console.log('imageFilesCount[0[]:', imageFilesCount[0]);

    if (!prompt) {
      return createResponse(400, { code: 400, error: 'prompt 不能为空' });
    }

    let image = [];
    for (const file of imageFiles) {
       if (file?.arrayBuffer && typeof file.arrayBuffer === 'function') {
        // 读取文件并转为 base64
        const bytes = await file.arrayBuffer();
        const base64 = Buffer.from(bytes).toString('base64');
        // 根据文件类型添加 data URI 前缀
        const mimeType = file.type || 'image/jpeg';
        image.push(`data:${mimeType};base64,${base64}`);
      }
    }

    console.log('[generate] Calling API:', { 
      prompt: prompt?.slice(0, 50) + '...', 
      size,
      imageCount: image?.length
    });

    console.log('image[0[]:', image[0]?.slice(0, 30) + '...');

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

    console.log('[generate] Success, response length:', response.data[0]?.b64_json?.length);
    
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