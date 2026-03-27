const generateImageWand = async (body) => {
  const { prompt = '', size = '2K', image = [] } = body;

  if (!prompt) {
    return sendJson(400, { code: 400, error: 'prompt 不能为空' });
  }
  const _images = image.map(item => {
    return {
      image: item
    }
  })
  const rquestParams = {
    model: "wan2.6-image",
    input: {
      messages: [
        {
          role: "user",
          content: [
            {
              text: prompt
            },
            ..._images
          ]
        }
      ]
    },
    parameters: {
      prompt_extend: true,
      watermark: watermark,
      n: 1,
      enable_interleave: false,
      size: size == '2K' ? '1K' : '2K',
    }
  }
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${'sk-4e977c2d14fd4f3a822e62322d93158f'}`
    },
    body: JSON.stringify(rquestParams),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) {
    sendJson(response.status, { code: response.status, error: response.statusText });
  }

  const result = await response.json();
  if (result.output && result.output.choices) {
    const imageUrls = [];
    result.output.choices.forEach((choice, index) => {
      choice.message.content.forEach(content => {
        if (content.type === "image") {
          console.log(`图片${index + 1} URL: ${content.image}`);
          imageUrls.push({
            url: content.image,
            index: index + 1
          });
        }
      });
    });
    return sendJson(200, {
      code: 200,
      data: imageUrls[0],
      message: '调用成功',
    });
  }
  return sendJson(500, { code: 500, error: '生成图片错误' });
}