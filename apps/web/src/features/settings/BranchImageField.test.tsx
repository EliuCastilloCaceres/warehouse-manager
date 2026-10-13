import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { apiError, callsTo, jsonResponse, mockFetch } from '@/test/http';
import { BranchImageField } from './BranchImageField';

const UPLOAD = 'POST /api/v1/uploads/branch-images';
const IMAGE_URL = '/uploads/branch/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.webp';

function Harness({ initial = null, onChange }: { initial?: string | null; onChange: jest.Mock }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <BranchImageField
      id="logo"
      label="Logo"
      value={value}
      onChange={(url) => {
        onChange(url);
        setValue(url);
      }}
    />
  );
}

const file = () => new File(['png'], 'logo.png', { type: 'image/png' });

describe('BranchImageField (T19)', () => {
  it('sube el archivo con FormData, guarda la url y muestra la imagen', async () => {
    const fetchMock = mockFetch({
      [UPLOAD]: () =>
        jsonResponse(201, {
          url: IMAGE_URL,
          thumbUrl: IMAGE_URL.replace('.webp', '.thumb.webp'),
          width: 400,
          height: 200,
        }),
    });
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.upload(screen.getByLabelText('Logo'), file());

    expect(await screen.findByRole('img', { name: 'Logo' })).toHaveAttribute('src', IMAGE_URL);
    expect(onChange).toHaveBeenCalledWith(IMAGE_URL);
    const [, init] = callsTo(fetchMock, UPLOAD)[0]!;
    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('logo.png');
  });

  it('"Quitar" deja el campo en null', async () => {
    const onChange = jest.fn();
    render(<Harness initial={IMAGE_URL} onChange={onChange} />);
    expect(screen.getByRole('img', { name: 'Logo' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('img', { name: 'Logo' })).not.toBeInTheDocument();
  });

  it.each([
    [413, 'PAYLOAD_TOO_LARGE', 'El archivo es demasiado grande.'],
    [415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de archivo no permitido.'],
  ])('un %i muestra el mensaje de la API', async (status, code, message) => {
    mockFetch({ [UPLOAD]: () => apiError(status, code, message) });
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.upload(screen.getByLabelText('Logo'), file());

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onChange).not.toHaveBeenCalled();
  });
});
