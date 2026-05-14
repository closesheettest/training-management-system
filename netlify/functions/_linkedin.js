// LinkedIn personal-profile posting helper.
//
// Required env vars: LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN
//
// LINKEDIN_ACCESS_TOKEN expires every 60 days (LinkedIn's policy for
// w_member_social tokens). When it expires, re-run the OAuth dance: visit
// the OAuth URL, paste the code back, exchange for a fresh access token,
// update the env var, redeploy. ~5 minutes.
//
// Image flow is more complex than Facebook's — LinkedIn requires you to
// register the upload, PUT the image bytes to their CDN, then reference
// the returned asset URN in the post. Helper hides that complexity.
//
// Returns { ok, post_id?, error?, step? } — never throws.

const API = 'https://api.linkedin.com'

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  }
}

export async function postToLinkedIn({ message, photoUrl }) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN
  const author = process.env.LINKEDIN_PERSON_URN
  if (!token || !author) {
    return { ok: false, step: 'precheck', error: 'LINKEDIN_ACCESS_TOKEN or LINKEDIN_PERSON_URN not set' }
  }
  if (!message || !message.trim()) {
    return { ok: false, step: 'precheck', error: 'No message body provided' }
  }

  let assetUrn = null
  if (photoUrl) {
    const upload = await uploadImageToLinkedIn(photoUrl, author)
    if (!upload.ok) {
      // Fall through to text-only post — better to publish without the image
      // than fail the whole thing on a CDN hiccup.
      console.warn('LinkedIn image upload failed, posting text-only:', upload.error)
    } else {
      assetUrn = upload.assetUrn
    }
  }

  const body = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: message },
        shareMediaCategory: assetUrn ? 'IMAGE' : 'NONE',
        ...(assetUrn
          ? {
              media: [
                {
                  status: 'READY',
                  media: assetUrn,
                  title: { text: 'Training' },
                },
              ],
            }
          : {}),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  }

  try {
    const res = await fetch(`${API}/v2/ugcPosts`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        step: 'li_publish',
        error: json.message || json.serviceErrorCode || `HTTP ${res.status}`,
        details: json,
      }
    }
    // Successful response includes the post id in the body or x-restli-id header
    const postId = json.id || res.headers.get('x-restli-id') || null
    return { ok: true, post_id: postId, used_photo: !!assetUrn }
  } catch (err) {
    return { ok: false, step: 'exception', error: err.message || 'Unknown' }
  }
}

// Multi-step image upload:
//   1. Register the upload — LinkedIn returns an upload URL + asset URN
//   2. Fetch the image bytes from Supabase Storage (or wherever)
//   3. PUT those bytes to the upload URL
//   4. Return the asset URN to attach to the ugcPost
async function uploadImageToLinkedIn(imageUrl, owner) {
  try {
    // Step 1
    const registerRes = await fetch(`${API}/v2/assets?action=registerUpload`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner,
          serviceRelationships: [
            { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
          ],
        },
      }),
    })
    const registerJson = await registerRes.json().catch(() => ({}))
    if (!registerRes.ok) {
      return { ok: false, error: `register: ${registerJson.message || registerRes.status}` }
    }
    const uploadUrl =
      registerJson.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
    const assetUrn = registerJson.value?.asset
    if (!uploadUrl || !assetUrn) {
      return { ok: false, error: 'Missing upload URL or asset URN in register response' }
    }

    // Step 2: fetch the image
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return { ok: false, error: `fetch image: HTTP ${imgRes.status}` }
    const imgBuffer = await imgRes.arrayBuffer()

    // Step 3: PUT to LinkedIn's CDN
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}` },
      body: Buffer.from(imgBuffer),
    })
    if (!putRes.ok) {
      const txt = await putRes.text().catch(() => '')
      return { ok: false, error: `upload PUT: HTTP ${putRes.status}: ${txt.slice(0, 200)}` }
    }

    return { ok: true, assetUrn }
  } catch (err) {
    return { ok: false, error: err.message || 'Unknown' }
  }
}
