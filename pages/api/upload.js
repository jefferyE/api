// 这是 Pages Router 的写法，需要配置 bodyParser
import formidable from 'formidable';
import path from 'path';
import fs from 'fs';

// 确保上传目录存在
const uploadDir = path.join(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export const config = {
  api: {
    bodyParser: false,  // 必须禁用，formidable 需要自己处理流
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 配置 formidable
    const form = formidable({
      uploadDir,
      keepExtensions: true,           // 保留文件扩展名
      maxFileSize: 10 * 1024 * 1024,  // 限制 10MB
    });

    // 解析 FormData
    const [fields, files] = await form.parse(req);

    // fields: 普通表单字段 { name: ['张三'] }
    // files: 上传的文件 { avatar: [PersistentFile] }

    const file = files.file?.[0];  // 获取上传的文件
    
    res.status(200).json({
      success: true,
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, v[0]])
      ),
      file: file ? {
        originalName: file.originalFilename,
        savedPath: file.filepath,
        size: file.size,
        mimetype: file.mimetype,
      } : null,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
}
