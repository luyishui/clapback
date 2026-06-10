type SubNavOption<T extends string> = { value: T; label: string };

type SubNavPillsProps<T extends string> = {
  options: SubNavOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
};

export function SubNavPills<T extends string>({ options, value, onChange, ariaLabel }: SubNavPillsProps<T>) {
  return (
    <div className="subnav-pills" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          type="button"
          aria-selected={value === opt.value}
          className={`subnav-pills__item ${value === opt.value ? "subnav-pills__item--active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

type FilterPillsProps<T extends string> = {
  options: SubNavOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
};

export function FilterPills<T extends string>({ options, value, onChange, ariaLabel }: FilterPillsProps<T>) {
  return (
    <div className="filter-pills" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          role="radio"
          type="button"
          aria-checked={value === opt.value}
          className={`filter-pills__item ${value === opt.value ? "filter-pills__item--active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
