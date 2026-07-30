import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const APP_SECRET = Deno.env.get('APP_SECRET')
if (!APP_SECRET) {
  throw new Error('APP_SECRET is not set — configure it in Supabase Edge Function Secrets before deploying.')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const respond = (data: object, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json()

    // Simple secret key check — no JWT needed
    if (body.secret !== APP_SECRET) {
      return respond({ error: 'Unauthorized' }, 401)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action } = body

    if (action === 'create') {
      const { full_name, email, password, role, use_email, viewer_plates } = body
      if (!full_name || !password) return respond({ error: 'Name and password required' }, 400)
      if (password.length < 6) return respond({ error: 'Password must be at least 6 characters' }, 400)

      const finalEmail = use_email && email
        ? email
        : `${full_name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '')}.${Date.now()}@5gems.internal`

      const { data: newUser, error } = await admin.auth.admin.createUser({
        email: finalEmail, password, email_confirm: true,
        user_metadata: { full_name, role: role || 'staff' }
      })
      if (error) return respond({ error: error.message }, 400)

      await admin.from('profiles').upsert({
        id: newUser.user.id, email: finalEmail, full_name, role: role || 'staff',
        ...(role === 'viewer' && { viewer_plates: viewer_plates || [] }),
      })
      return respond({ success: true, user: { id: newUser.user.id, full_name, email: finalEmail, role } })
    }

    if (action === 'delete') {
      const { user_id } = body
      if (!user_id) return respond({ error: 'user_id required' }, 400)
      await admin.from('profiles').delete().eq('id', user_id)
      const { error } = await admin.auth.admin.deleteUser(user_id)
      if (error) return respond({ error: error.message }, 400)
      return respond({ success: true })
    }

    if (action === 'update_password') {
      const { user_id, new_password, full_name, role, viewer_plates } = body
      if (!user_id) return respond({ error: 'user_id required' }, 400)
      if (new_password) {
        if (new_password.length < 6) return respond({ error: 'Password must be at least 6 characters' }, 400)
        const { error } = await admin.auth.admin.updateUserById(user_id, { password: new_password })
        if (error) return respond({ error: error.message }, 400)
      }
      if (full_name || role || viewer_plates !== undefined) {
        await admin.from('profiles').update({
          ...(full_name && { full_name }),
          ...(role && { role }),
          ...(viewer_plates !== undefined && { viewer_plates }),
        }).eq('id', user_id)
      }
      return respond({ success: true })
    }

    return respond({ error: 'Unknown action' }, 400)

  } catch (err) {
    return respond({ error: err.message }, 500)
  }
})
