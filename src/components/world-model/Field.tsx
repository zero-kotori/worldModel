type FieldProps = {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  placeholder?: string;
  required?: boolean;
  step?: string;
  min?: string;
  max?: string;
};

export function Field({ label, name, type = "text", defaultValue, placeholder, required, step, min, max }: FieldProps) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-ink/65">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        step={step}
        min={min}
        max={max}
        className="min-h-9 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-moss"
      />
    </label>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  placeholder,
  required
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-ink/65">
      <span>{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        rows={4}
        className="w-full min-w-0 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss"
      />
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue
}: {
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  defaultValue?: string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-ink/65">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="min-h-9 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-moss"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
