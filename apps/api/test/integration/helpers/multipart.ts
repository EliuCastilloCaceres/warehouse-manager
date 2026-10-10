/** Arma un body `multipart/form-data` con un archivo (para `app.inject`). */
export function multipartFile(
  buffer: Buffer,
  { field = 'file', filename = 'foto.jpg', contentType = 'image/jpeg' } = {},
) {
  const boundary = '----wm-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
