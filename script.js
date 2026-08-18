document.addEventListener('DOMContentLoaded', () => {

  // --- Dark Mode Initialization & Persistence ---
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    document.body.classList.add('dark-theme');
    if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i> Light Mode';
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      
      const isDark = document.body.classList.contains('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      themeToggleBtn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
    });
  }
  // ---------------------------------------------

  const DEFAULT_POSTS = [
    {
      id: 1,
      author: 'Emmanuel A.',
      initials: 'EA',
      time: '2 hours ago',
      content: 'Excited for the upcoming Soroti Youth Innovation Hub workshop this Saturday!',
      likes: 12,
      liked: false,
      dislikes: 1,
      disliked: false,
      comments: [
        { author: 'John O.', text: 'See you there!' }
      ]
    }
  ];

  let posts = JSON.parse(localStorage.getItem('soroti_forum_posts')) || DEFAULT_POSTS;
  let currentUser = JSON.parse(localStorage.getItem('soroti_forum_user')) || null;
  let isSignUpMode = false;
  let uploadedAvatarData = null;

  const elements = {
    authScreen: document.getElementById('authScreen'),
    appContent: document.getElementById('appContent'),
    authPageForm: document.getElementById('authPageForm'),
    tabLoginBtn: document.getElementById('tabLoginBtn'),
    tabSignupBtn: document.getElementById('tabSignupBtn'),
    fullNameGroup: document.getElementById('fullNameGroup'),
    pageAuthName: document.getElementById('pageAuthName'),
    pageAuthEmail: document.getElementById('pageAuthEmail'),
    pageAuthPassword: document.getElementById('pageAuthPassword'),
    pageAuthSubmitBtn: document.getElementById('pageAuthSubmitBtn'),
    authErrorMsg: document.getElementById('authErrorMsg'),

    navDrawer: document.getElementById('navDrawer'),
    navBtns: document.querySelectorAll('.nav-btn'),
    drawerCloseBtn: document.querySelector('#navDrawer .close-btn'),
    
    profileNames: document.querySelectorAll('.profile-name'),
    profileEmails: document.querySelectorAll('.profile-email'),
    profileAvatars: document.querySelectorAll('.profile-avatar'),
    
    logoutBtns: document.querySelectorAll('.logout-btn'),
    signupBtn: document.querySelector('.signup-btn'),
    searchInput: document.getElementById('searchInput'),
    searchActionBtn: document.getElementById('searchActionBtn'),

    postText: document.getElementById('postText'),
    postPhotoInput: document.getElementById('postPhotoInput'),
    postFileInput: document.getElementById('postFileInput'),
    postBtn: document.querySelector('.post-btn'),
    feedContainer: document.getElementById('feedContainer'),
    fabBtn: document.querySelector('.fab-btn'),
    toastNotice: document.getElementById('toastNotice'),
    toastClose: document.querySelector('.toast-close'),

    chatPopup: document.getElementById('chatPopup'),
    chatFriendName: document.getElementById('chatFriendName'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatFileInput: document.getElementById('chatFileInput'),
    chatSendBtn: document.getElementById('chatSendBtn'),
    chatCloseBtn: document.getElementById('chatCloseBtn'),
    chatBtns: document.querySelectorAll('.chat-btn'),
    
    callBtn: document.querySelector('.call-btn'),
    videoBtn: document.querySelector('.video-btn'),

    tabBtns: document.querySelectorAll('.tab-btn'),
    tabViews: document.querySelectorAll('.tab-view')
  };

  function init() {
    updateAuthView();
    bindEvents();
  }

  function updateAuthView() {
    if (currentUser) {
      if (elements.authScreen) elements.authScreen.classList.add('hidden');
      if (elements.appContent) elements.appContent.classList.remove('hidden');
      if (elements.signupBtn) elements.signupBtn.classList.add('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.remove('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.remove('hidden'));
      updateUserUI();
      renderFeed();
    } else {
      if (elements.authScreen) elements.authScreen.classList.remove('hidden');
      if (elements.appContent) elements.appContent.classList.add('hidden');
      if (elements.signupBtn) elements.signupBtn.classList.remove('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.add('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.add('hidden'));
    }
  }

  function setAuthMode(signUp) {
    isSignUpMode = signUp;
    if (elements.authErrorMsg) elements.authErrorMsg.textContent = '';
    
    if (isSignUpMode) {
      elements.tabSignupBtn?.classList.add('active');
      elements.tabLoginBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.remove('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Create Account';
    } else {
      elements.tabLoginBtn?.classList.add('active');
      elements.tabSignupBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.add('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Log In';
    }
  }

  function handleAuthSubmit(e) {
    e.preventDefault();
    const email = elements.pageAuthEmail.value.trim();
    const password = elements.pageAuthPassword.value.trim();
    const name = elements.pageAuthName ? elements.pageAuthName.value.trim() : '';

    if (!email || !password || (isSignUpMode && !name)) {
      if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Please fill in all required fields.';
      return;
    }

    if (password.length < 6) {
      if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Password must be at least 6 characters.';
      return;
    }

    currentUser = {
      name: isSignUpMode ? name : email.split('@')[0],
      email: email,
      avatarUrl: null
    };

    localStorage.setItem('soroti_forum_user', JSON.stringify(currentUser));
    updateAuthView();
    showToast(`Welcome back, ${currentUser.name}! 🎉`);

    elements.pageAuthEmail.value = '';
    elements.pageAuthPassword.value = '';
    if (elements.pageAuthName) elements.pageAuthName.value = '';
  }

  function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
      localStorage.removeItem('soroti_forum_user');
      currentUser = null;
      updateAuthView();
    }
  }

  function updateUserUI() {
    if (!currentUser) return;
    elements.profileNames.forEach(el => el.textContent = currentUser.name);
    elements.profileEmails.forEach(el => el.textContent = currentUser.email);
    
    elements.profileAvatars.forEach(el => {
      if (currentUser.avatarUrl) {
        el.style.backgroundImage = `url(${currentUser.avatarUrl})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = 'none';
        el.textContent = getInitials(currentUser.name);
      }
    });

    // Populate settings input fields if available
    const nameInput = document.getElementById('settingsNameInput');
    const emailInput = document.getElementById('settingsEmailInput');
    if (nameInput) nameInput.value = currentUser.name;
    if (emailInput) emailInput.value = currentUser.email;
  }

  function renderFeed(filterQuery = '') {
    if (!elements.feedContainer) return;

    let displayPosts = posts;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      displayPosts = posts.filter(p => p.content.toLowerCase().includes(q) || p.author.toLowerCase().includes(q));
    }

    if (displayPosts.length === 0) {
      elements.feedContainer.innerHTML = `
        <div class="card">
          <div class="animated-stripe-bar"></div>
          <h3>No posts found</h3>
          <p style="color: #888; margin-top: 8px; font-size: 14px;">Try another search term or share an update!</p>
        </div>`;
      return;
    }

    elements.feedContainer.innerHTML = displayPosts.map(post => `
      <div class="card post-card" data-id="${post.id}">
        <div class="animated-stripe-bar"></div>
        
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div class="friend-user">
            <div class="avatar-wrapper"><div class="avatar">${post.initials}</div></div>
            <div>
              <strong style="font-size: 14px; display: block;">${escapeHTML(post.author)}</strong>
              <span style="font-size: 11px; color: #888;">${post.time}</span>
            </div>
          </div>
          <button onclick="deletePost(${post.id})" style="background: none; border: none; color: #999; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
        </div>
        
        <p style="font-size: 14px; line-height: 1.5; margin-bottom: 10px;">${escapeHTML(post.content)}</p>
        
        ${post.attachment ? `<div style="margin-bottom: 12px; font-size: 12px; opacity: 0.8; background: rgba(0,0,0,0.03); padding: 6px; border-radius: 6px;"><i class="fa-solid fa-paperclip"></i> Attached: ${escapeHTML(post.attachment)}</div>` : ''}
        
        <div style="display: flex; gap: 15px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px; font-size: 13px; align-items: center;">
          <button onclick="toggleLike(${post.id})" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${post.liked ? '#e50914' : 'inherit'};">
            ${post.liked ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>'} ${post.likes}
          </button>
          <button onclick="toggleDislike(${post.id})" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${post.disliked ? '#e50914' : 'inherit'};">
            ${post.disliked ? '<i class="fa-solid fa-thumbs-down"></i>' : '<i class="fa-regular fa-thumbs-down"></i>'} ${post.dislikes || 0}
          </button>
          <button onclick="toggleCommentSection(${post.id})" style="background: none; border: none; cursor: pointer; font-weight: bold; color: inherit;">
            <i class="fa-solid fa-comment"></i> Comment (${post.comments ? post.comments.length : 0})
          </button>
        </div>

        <div id="commentSection-${post.id}" class="hidden" style="margin-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 8px;">
          <div style="max-height: 120px; overflow-y: auto; margin-bottom: 8px;">
            ${(post.comments || []).map(c => `
              <div style="font-size: 12px; background: rgba(0,0,0,0.03); padding: 5px 8px; border-radius: 4px; margin-bottom: 4px;">
                <strong>${escapeHTML(c.author)}:</strong> ${escapeHTML(c.text)}
              </div>
            `).join('')}
          </div>
          <div style="display: flex; gap: 5px;">
            <input type="text" id="commentInput-${post.id}" placeholder="Write a comment..." style="flex:1; padding: 6px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px; outline: none; background: transparent; color: var(--text-color);" />
            <button onclick="addComment(${post.id})" style="padding: 6px 10px; background: var(--color-black); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;"><i class="fa-solid fa-paper-plane"></i></button>
          </div>
        </div>

      </div>
    `).join('');
  }

  function handleCreatePost() {
    const content = elements.postText.value.trim();
    const photoFile = elements.postPhotoInput.files[0];
    const generalFile = elements.postFileInput.files[0];
    const attachedName = photoFile ? photoFile.name : (generalFile ? generalFile.name : null);

    if (!content && !attachedName) return;

    const newPost = {
      id: Date.now(),
      author: currentUser ? currentUser.name : 'Anonymous',
      initials: getInitials(currentUser ? currentUser.name : 'AN'),
      time: 'Just now',
      content: content || '[Attachment]',
      attachment: attachedName,
      likes: 0,
      liked: false,
      dislikes: 0,
      disliked: false,
      comments: []
    };

    posts.unshift(newPost);
    localStorage.setItem('soroti_forum_posts', JSON.stringify(posts));
    renderFeed();
    elements.postText.value = '';
    elements.postPhotoInput.value = '';
    elements.postFileInput.value = '';
    showToast('🚀 Post published successfully!');
  }

  window.toggleLike = function(id) {
    posts = posts.map(p => p.id === id ? { ...p, likes: p.liked ? p.likes - 1 : p.likes + 1, liked: !p.liked } : p);
    localStorage.setItem('soroti_forum_posts', JSON.stringify(posts));
    renderFeed(elements.searchInput ? elements.searchInput.value : '');
  };

  window.toggleDislike = function(id) {
    posts = posts.map(p => p.id === id ? { ...p, dislikes: (p.dislikes || 0) + (p.disliked ? -1 : 1), disliked: !p.disliked } : p);
    localStorage.setItem('soroti_forum_posts', JSON.stringify(posts));
    renderFeed(elements.searchInput ? elements.searchInput.value : '');
  };

  window.toggleCommentSection = function(id) {
    const section = document.getElementById(`commentSection-${id}`);
    if (section) {
      section.classList.toggle('hidden');
    }
  };

  window.addComment = function(id) {
    const input = document.getElementById(`commentInput-${id}`);
    if (!input || !input.value.trim()) return;

    posts = posts.map(p => {
      if (p.id === id) {
        const comments = p.comments || [];
        comments.push({
          author: currentUser ? currentUser.name : 'Anonymous',
          text: input.value.trim()
        });
        return { ...p, comments };
      }
      return p;
    });

    localStorage.setItem('soroti_forum_posts', JSON.stringify(posts));
    renderFeed(elements.searchInput ? elements.searchInput.value : '');
  };

  window.deletePost = function(id) {
    posts = posts.filter(p => p.id !== id);
    localStorage.setItem('soroti_forum_posts', JSON.stringify(posts));
    renderFeed(elements.searchInput ? elements.searchInput.value : '');
  };

  window.openChat = function(friendName) {
    if (!elements.chatPopup) return;
    elements.chatFriendName.textContent = `Chat with ${friendName || 'Friend'}`;
    elements.chatPopup.classList.remove('hidden');
    elements.chatMessages.innerHTML = `<div class="chat-msg system">Started chat with ${friendName || 'Friend'}</div>`;
  };

  window.openChatFromTab = function(friendName) {
    openChat(friendName);
  };

  function sendChatMessage() {
    const text = elements.chatInput.value.trim();
    const chatFile = elements.chatFileInput.files[0];
    if (!text && !chatFile) return;

    let content = text;
    if (chatFile) {
      content += ` [Attached: ${chatFile.name}]`;
    }

    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg outgoing';
    msgEl.textContent = content;
    elements.chatMessages.appendChild(msgEl);

    elements.chatInput.value = '';
    elements.chatFileInput.value = '';
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  function showToast(message) {
    if (!elements.toastNotice) return;
    elements.toastNotice.querySelector('span').innerHTML = message;
    elements.toastNotice.style.display = 'flex';
    setTimeout(() => { elements.toastNotice.style.display = 'none'; }, 4000);
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }

  function getInitials(name) {
    return name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2) || 'SY';
  }

  function bindEvents() {
    if (elements.tabLoginBtn) elements.tabLoginBtn.addEventListener('click', () => setAuthMode(false));
    if (elements.tabSignupBtn) elements.tabSignupBtn.addEventListener('click', () => setAuthMode(true));
    if (elements.authPageForm) elements.authPageForm.addEventListener('submit', handleAuthSubmit);
    if (elements.signupBtn) {
      elements.signupBtn.addEventListener('click', () => { 
        localStorage.removeItem('soroti_forum_user'); 
        currentUser = null; 
        updateAuthView(); 
      });
    }
    elements.logoutBtns.forEach(btn => btn.addEventListener('click', handleLogout));

    if (elements.navBtns) {
      elements.navBtns.forEach(btn => {
        btn.addEventListener('click', () => elements.navDrawer?.classList.add('open'));
      });
    }

    if (elements.drawerCloseBtn) {
      elements.drawerCloseBtn.addEventListener('click', () => elements.navDrawer?.classList.remove('open'));
    }

    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => renderFeed(e.target.value.trim()));
    }
    
    if (elements.searchActionBtn) {
      elements.searchActionBtn.addEventListener('click', () => {
        if(elements.searchInput) renderFeed(elements.searchInput.value.trim());
      });
    }

    if (elements.postBtn) elements.postBtn.addEventListener('click', handleCreatePost);

    if (elements.fabBtn) {
      elements.fabBtn.addEventListener('click', () => {
        if (elements.postText) {
          elements.postText.focus();
          elements.postText.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    if (elements.toastClose) {
      elements.toastClose.addEventListener('click', () => elements.toastNotice.style.display = 'none');
    }

    elements.chatBtns.forEach(btn => {
      btn.addEventListener('click', () => openChat(btn.dataset.name));
    });

    if (elements.chatCloseBtn) {
      elements.chatCloseBtn.addEventListener('click', () => elements.chatPopup.classList.add('hidden'));
    }

    if (elements.chatSendBtn) {
      elements.chatSendBtn.addEventListener('click', sendChatMessage);
    }

    if (elements.chatInput) {
      elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
      });
    }
    
    if (elements.callBtn) {
      elements.callBtn.addEventListener('click', () => showToast('📞 Voice calling feature coming soon!'));
    }
    
    if (elements.videoBtn) {
      elements.videoBtn.addEventListener('click', () => showToast('📹 Video calling feature coming soon!'));
    }

    // Profile Picture Upload Preview Handler
    const profilePicInput = document.getElementById('profilePicInput');
    if (profilePicInput) {
      profilePicInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(event) {
            uploadedAvatarData = event.target.result;
            const previewEl = document.getElementById('settingsAvatarPreview');
            if (previewEl) {
              previewEl.style.backgroundImage = `url(${uploadedAvatarData})`;
              previewEl.style.backgroundSize = 'cover';
              previewEl.style.backgroundPosition = 'center';
              previewEl.textContent = '';
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }

// Save Settings Button Handler
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        const newName = document.getElementById('settingsNameInput').value.trim();
        const newEmail = document.getElementById('settingsEmailInput').value.trim();
        
        if (currentUser) {
          if (newName) currentUser.name = newName;
          if (newEmail) currentUser.email = newEmail;
          if (uploadedAvatarData) currentUser.avatarUrl = uploadedAvatarData;
          
          localStorage.setItem('soroti_forum_user', JSON.stringify(currentUser));
          updateUserUI();
          showToast('⚙️ Settings updated successfully!');
        }
      });
    }

    // Bind Navigation Link Items for Tab Switching
    document.querySelectorAll('.nav-link-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = link.getAttribute('data-tab');
        
        if (elements.navDrawer) elements.navDrawer.classList.remove('open');

        elements.tabViews.forEach(view => view.classList.add('hidden'));
        const activeView = document.getElementById(`${targetTab}View`);
        if (activeView) activeView.classList.remove('hidden');

        // Also sync main action tabs highlight if applicable
        elements.tabBtns.forEach(btn => {
          if (btn.getAttribute('data-tab') === targetTab) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      });
    });
    
    elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-tab');

        elements.tabBtns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        elements.tabViews.forEach(view => {
          view.classList.add('hidden');
          if (view.id === `${targetTab}View`) {
            view.classList.remove('hidden');
          }
        });
      });
    });
  }

  init();
});