# Compliance

SADIN is designed to support Saudi requirements for protecting data that leaves the
organisation. It is a technical control; it does not make an organisation compliant on its own.

## NCA Essential Cybersecurity Controls (ECC-2:2024)

| ECC subdomain | How SADIN supports it | State |
|---|---|---|
| 2-7 Data and Information Protection | Classification-aware control of data leaving through AI tools: block, redact or warn per data class | Built |
| 2-12 Cybersecurity Event Logs and Monitoring Management | Every decision logged centrally with user, tool, channel, action and data classes; CEF export to the SIEM | Built |
| 2-2 Identity and Access Management | AI use tied to the work identity; SSO on an enterprise AI tenant with conditional access | Log identity built; SSO designed |
| 2-6 Mobile Devices Security | Company data kept on managed devices; Gateway for unmanaged ones | Designed |
| Domain 4: Third-Party and Cloud Computing Cybersecurity (4-1, 4-2) | Controlled use of external AI services; inspection on premises, never in another cloud | Built (on-prem inspection) |
| 1-10 Cybersecurity Awareness and Training Program | Bilingual notices that explain what was removed and why, at the moment it happens | Built |

## NDMO data classification

| NDMO level | Target policy | Prototype default |
|---|---|---|
| Top Secret | Block | Block |
| Secret | Block | Block |
| Restricted | Redact, or allow with a justification | Block (stricter) |
| Public | Allow | Allow |

The prototype blocks every classification marking it finds, which is stricter than the target
policy for Restricted content. Credentials, internal network details and account identifiers
are redacted wherever they appear, whatever the document's level.

## People stay in charge

- Policies are written and approved by the security and data-governance teams, not by SADIN.
- Exceptions are requested by the employee with a business justification and approved by a
  named owner; the request is logged, and the content is not sent in the meantime.
- SADIN never decides a document's classification on its own. It reads the markings people put
  there and applies the policy people wrote.

## Employee privacy

The decision log records metadata only: who, which tool, which channel, which action and which
data classes. It never stores the text, the image or the matched values. It is kept on the
organisation's premises, access is restricted by role, and employees are told it exists through
the acceptable-use policy they sign.
