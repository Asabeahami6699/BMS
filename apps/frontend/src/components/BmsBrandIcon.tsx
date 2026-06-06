import bmsLogo from "../favIconBms.png";

type Props = {
  className?: string;
};

export function BmsBrandIcon({ className = "dash-brand-icon" }: Props) {
  return (
    <div className={className} aria-hidden>
      <img src={bmsLogo} alt="" />
    </div>
  );
}
