import './InfoIcon.css'

interface Props {
  text: string
}

export default function InfoIcon({ text }: Props) {
  return (
    <span className="info-icon" tabIndex={0} aria-label={text}>
      <span className="info-icon-dot">i</span>
      <span className="info-icon-tip" role="tooltip">{text}</span>
    </span>
  )
}
