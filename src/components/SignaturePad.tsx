import { useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear: () => void;
}

export function SignaturePad({ onSave, onClear }: SignaturePadProps) {
  const sigPad = useRef<SignatureCanvas>(null);

  const clear = () => {
    sigPad.current?.clear();
    onClear();
  };

  const save = () => {
    if (sigPad.current?.isEmpty()) return;
    const dataUrl = sigPad.current?.getTrimmedCanvas().toDataURL('image/png');
    if (dataUrl) onSave(dataUrl);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border-2 border-gray-200 rounded-lg bg-white overflow-hidden">
        <SignatureCanvas
          ref={sigPad}
          penColor="black"
          canvasProps={{
            className: "w-full h-48 cursor-crosshair",
          }}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={clear}
          className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          Temizle
        </button>
        <button
          onClick={save}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          İmzayı Kaydet
        </button>
      </div>
    </div>
  );
}
